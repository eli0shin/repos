import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  resolveRepo,
  getWorktreePath,
  getParentBranch,
  recordStack,
} from '../config.ts';
import {
  createWorktree,
  listWorktrees,
  ensureRefspecConfig,
  findWorktreeByBranch,
  localBranchExists,
  getDefaultBranch,
  runGitCommand,
} from '../git/index.ts';
import { print, printError, printStatus } from '../output.ts';

export async function workCommand(
  ctx: CommandContext,
  branch: string,
  repoName?: string
): Promise<void> {
  const config = await loadConfig(ctx.configPath);
  const repo = await resolveRepo(config, repoName);

  // Check if worktree already exists - if so, output path and return
  const worktreesResult = await listWorktrees(repo.path);
  if (worktreesResult.success) {
    const existing = findWorktreeByBranch(worktreesResult.data, branch);
    if (existing) {
      // Output path to stdout for shell wrapper to cd into
      print(existing.path);
      return;
    }
  }

  // Check if branch is new (doesn't exist locally or on remote)
  // so we know whether to record a stack relationship after creation
  const localExists = await localBranchExists(repo.path, branch);
  let remoteExists = false;
  if (!localExists) {
    const remoteBranchResult = await runGitCommand(
      ['ls-remote', '--heads', 'origin', branch],
      repo.path
    );
    remoteExists =
      remoteBranchResult.exitCode === 0 &&
      remoteBranchResult.stdout.includes(`refs/heads/${branch}`);
  }
  const isNewBranch = !localExists && !remoteExists;

  // Ensure refspec is configured correctly (fixes bare repo issues)
  await ensureRefspecConfig(repo.path);

  const worktreePath = getWorktreePath(repo.path, branch);
  // Status messages go to stderr so shell wrapper can capture clean path from stdout
  printStatus(`Creating worktree for "${branch}"...`);

  const result = await createWorktree(repo.path, worktreePath, branch);
  if (!result.success) {
    printError(`Error: ${result.error}`);
    process.exit(1);
  }

  // Stack new branches on the default branch so restack/unstack work
  // Skip if branch already has a stack relationship in config
  if (isNewBranch && !getParentBranch(repo, branch)) {
    const defaultBranchResult = await getDefaultBranch(repo.path);
    if (defaultBranchResult.success) {
      const defaultBranch = defaultBranchResult.data;
      const headResult = await runGitCommand(
        ['rev-parse', `origin/${defaultBranch}`],
        repo.path
      );
      if (headResult.exitCode === 0) {
        await recordStack(
          repo.path,
          ctx.configPath,
          config,
          repo,
          defaultBranch,
          branch,
          headResult.stdout.trim()
        );
      }
    }
  }

  printStatus(`Created worktree "${repo.name}-${branch.replace(/\//g, '-')}"`);
  // Output path to stdout for shell wrapper to cd into
  print(worktreePath);
}
