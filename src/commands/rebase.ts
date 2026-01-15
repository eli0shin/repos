import type { CommandContext } from '../cli.ts';
import { loadConfig, resolveRepo } from '../config.ts';
import {
  getDefaultBranch,
  resolveWorktree,
  fetchAndRebase,
} from '../git/index.ts';
import { print, printError } from '../output.ts';

export async function rebaseCommand(
  ctx: CommandContext,
  branch?: string,
  repoName?: string
): Promise<void> {
  const config = await loadConfig(ctx.configPath);
  const repo = await resolveRepo(config, repoName);
  const worktree = await resolveWorktree(repo.path, branch);

  // Get default branch
  const defaultBranchResult = await getDefaultBranch(repo.path);
  if (!defaultBranchResult.success) {
    printError(`Error: ${defaultBranchResult.error}`);
    process.exit(1);
  }

  const defaultBranch = defaultBranchResult.data;
  print(`Fetching and rebasing "${worktree.branch}" on "${defaultBranch}"...`);

  await fetchAndRebase(worktree.path, `origin/${defaultBranch}`);

  print(`Rebased "${worktree.branch}" on "${defaultBranch}"`);
}
