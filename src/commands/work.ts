import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  resolveRepoWithConfig,
  getWorktreePath,
} from '../config.ts';
import {
  createWorktree,
  listWorktrees,
  ensureRefspecConfig,
  findWorktreeByBranch,
  checkIsNewBranch,
} from '../git/index.ts';
import { print, printError, printStatus } from '../output.ts';
import { ensureTmuxSession, openTmuxSession } from '../tmux.ts';
import { loadRepoWorktreeConfig } from '../worktree-config.ts';
import { printSetupWarnings, runWorktreeSetup } from '../worktree-setup.ts';
import { resolveWorktreeIndex } from '../worktree-index.ts';
import { recordBranchStackOnDefault } from '../branch-stack/index.ts';

type WorkOptions = { tmux?: boolean; focus?: boolean; index?: number };

export async function workCommand(
  ctx: CommandContext,
  branch?: string,
  repoName?: string,
  options?: WorkOptions
): Promise<void> {
  const initialConfig = await loadConfig(ctx.configPath);
  const { repo, config } = await resolveRepoWithConfig(
    ctx.configPath,
    initialConfig,
    repoName
  );
  const requestedIndex = options?.index;

  if (requestedIndex !== undefined && branch) {
    printError('Error: cannot specify both branch and --index');
    process.exit(1);
  }

  if (requestedIndex !== undefined) {
    const indexedResult = await resolveWorktreeIndex(repo, requestedIndex);
    if (!indexedResult.success) {
      printError(indexedResult.error);
      process.exit(1);
    }

    if (options?.tmux) {
      if (options.focus === false) {
        await ensureTmuxSession(
          repo.name,
          indexedResult.data.branch,
          indexedResult.data.path
        );
        print(indexedResult.data.path);
      } else {
        await openTmuxSession(
          repo.name,
          indexedResult.data.branch,
          indexedResult.data.path
        );
      }
    } else {
      print(indexedResult.data.path);
    }
    return;
  }

  if (!branch) {
    printError('Error: missing required argument "branch"');
    process.exit(1);
  }

  // Check if worktree already exists
  const worktreesResult = await listWorktrees(repo.path);
  const existing = worktreesResult.success
    ? findWorktreeByBranch(worktreesResult.data, branch)
    : undefined;

  let worktreePath: string;

  if (existing) {
    worktreePath = existing.path;
  } else {
    const worktreeConfigResult = await loadRepoWorktreeConfig(repo.path);
    if (!worktreeConfigResult.success) {
      printError(
        `Error reading worktree config: ${worktreeConfigResult.error}`
      );
      process.exit(1);
    }

    // Check if branch is new (doesn't exist locally or on remote)
    // so we know whether to record a stack relationship after creation
    const isNewBranch = await checkIsNewBranch(repo.path, branch);

    // Ensure refspec is configured correctly (fixes bare repo issues)
    await ensureRefspecConfig(repo.path);

    worktreePath = getWorktreePath(repo.path, branch);
    // Status messages go to stderr so shell wrapper can capture clean path from stdout
    printStatus(`Creating worktree for "${branch}"...`);

    const result = await createWorktree(repo.path, worktreePath, branch);
    if (!result.success) {
      printError(`Error: ${result.error}`);
      process.exit(1);
    }

    // Stack new branches on the default branch so restack/unstack work
    if (isNewBranch) {
      const stackResult = await recordBranchStackOnDefault(
        ctx.configPath,
        config,
        repo,
        branch
      );
      for (const warning of stackResult.warnings) {
        printError(warning);
      }
    }

    const setupResult = await runWorktreeSetup(
      worktreeConfigResult.data.mainWorktreePath,
      worktreePath,
      worktreeConfigResult.data.config.setup
    );
    if (setupResult.warnings.length > 0) {
      printSetupWarnings(setupResult.warnings);
    }

    printStatus(
      `Created worktree "${repo.name}-${branch.replace(/\//g, '-')}"`
    );
  }

  if (options?.tmux && options.focus !== false) {
    await openTmuxSession(repo.name, branch, worktreePath);
  } else {
    if (options?.tmux) {
      await ensureTmuxSession(repo.name, branch, worktreePath);
    }
    // Output path to stdout for shell wrapper to cd into
    print(worktreePath);
  }
}
