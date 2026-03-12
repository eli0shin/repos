import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  resolveRepo,
  getWorktreePath,
  checkIsNewBranch,
  recordStackOnDefaultBranch,
} from '../config.ts';
import {
  createWorktree,
  listWorktrees,
  ensureRefspecConfig,
  findWorktreeByBranch,
} from '../git/index.ts';
import { print, printError, printStatus } from '../output.ts';
import { openTmuxSession } from '../tmux.ts';

export async function workCommand(
  ctx: CommandContext,
  branch: string,
  repoName?: string,
  options?: { tmux?: boolean }
): Promise<void> {
  const config = await loadConfig(ctx.configPath);
  const repo = await resolveRepo(config, repoName);

  // Check if worktree already exists
  const worktreesResult = await listWorktrees(repo.path);
  const existing = worktreesResult.success
    ? findWorktreeByBranch(worktreesResult.data, branch)
    : undefined;

  let worktreePath: string;

  if (existing) {
    worktreePath = existing.path;
  } else {
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
      await recordStackOnDefaultBranch(ctx.configPath, config, repo, branch);
    }

    printStatus(
      `Created worktree "${repo.name}-${branch.replace(/\//g, '-')}"`
    );
  }

  if (options?.tmux) {
    await openTmuxSession(repo.name, branch, worktreePath);
  } else {
    // Output path to stdout for shell wrapper to cd into
    print(worktreePath);
  }
}
