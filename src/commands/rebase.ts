import type { CommandContext } from '../cli.ts';
import { readConfig, findRepo, findRepoFromCwd } from '../config.ts';
import {
  fetchOrigin,
  rebaseOnBranch,
  getDefaultBranch,
  listWorktrees,
  findWorktreeByBranch,
  findWorktreeByDirectory,
} from '../git.ts';
import { print, printError } from '../output.ts';

export async function rebaseCommand(
  ctx: CommandContext,
  branch?: string,
  repoName?: string
): Promise<void> {
  const configResult = await readConfig(ctx.configPath);
  if (!configResult.success) {
    printError(`Error reading config: ${configResult.error}`);
    process.exit(1);
  }

  let repo;
  if (repoName) {
    repo = findRepo(configResult.data, repoName);
    if (!repo) {
      printError(`Error: "${repoName}" not found in config`);
      process.exit(1);
    }
  } else {
    repo = await findRepoFromCwd(configResult.data, process.cwd());
    if (!repo) {
      printError('Error: Not inside a tracked repo. Specify repo name.');
      process.exit(1);
    }
  }

  // Find the worktree
  const worktreesResult = await listWorktrees(repo.path);
  if (!worktreesResult.success) {
    printError(`Error: ${worktreesResult.error}`);
    process.exit(1);
  }

  // If no branch specified, detect from current working directory
  let worktree;
  if (branch) {
    worktree = findWorktreeByBranch(worktreesResult.data, branch);
    if (!worktree) {
      printError(`Error: No worktree found for branch "${branch}"`);
      process.exit(1);
    }
  } else {
    worktree = findWorktreeByDirectory(worktreesResult.data, process.cwd());
    if (!worktree) {
      printError('Error: Not inside a worktree. Specify branch name.');
      process.exit(1);
    }
    branch = worktree.branch;
  }

  // Get default branch
  const defaultBranchResult = await getDefaultBranch(repo.path);
  if (!defaultBranchResult.success) {
    printError(`Error: ${defaultBranchResult.error}`);
    process.exit(1);
  }

  const defaultBranch = defaultBranchResult.data;
  print(`Fetching and rebasing "${branch}" on "${defaultBranch}"...`);

  // Fetch first
  const fetchResult = await fetchOrigin(worktree.path);
  if (!fetchResult.success) {
    printError(`Error fetching: ${fetchResult.error}`);
    process.exit(1);
  }

  // Rebase
  const rebaseResult = await rebaseOnBranch(worktree.path, defaultBranch);
  if (!rebaseResult.success) {
    printError(`Error: ${rebaseResult.error}`);
    process.exit(1);
  }

  print(`Rebased "${branch}" on "${defaultBranch}"`);
}
