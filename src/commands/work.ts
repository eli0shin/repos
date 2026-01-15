import type { CommandContext } from '../cli.ts';
import { loadConfig, resolveRepo, getWorktreePath } from '../config.ts';
import {
  createWorktree,
  listWorktrees,
  ensureRefspecConfig,
  findWorktreeByBranch,
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

  printStatus(`Created worktree "${repo.name}-${branch.replace(/\//g, '-')}"`);
  // Output path to stdout for shell wrapper to cd into
  print(worktreePath);
}
