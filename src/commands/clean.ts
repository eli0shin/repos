import type { CommandContext } from '../cli.ts';
import { readConfig, findRepo, findRepoFromCwd } from '../config.ts';
import {
  removeWorktree,
  hasUncommittedChanges,
  listWorktrees,
} from '../git.ts';
import { print, printError } from '../output.ts';

export async function cleanCommand(
  ctx: CommandContext,
  branch: string,
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

  const worktree = worktreesResult.data.find((wt) => wt.branch === branch);
  if (!worktree) {
    printError(`Error: No worktree found for branch "${branch}"`);
    process.exit(1);
  }

  if (worktree.isMain) {
    printError('Error: Cannot remove the main worktree');
    process.exit(1);
  }

  // Check for uncommitted changes
  const changesResult = await hasUncommittedChanges(worktree.path);
  if (!changesResult.success) {
    printError(`Error: ${changesResult.error}`);
    process.exit(1);
  }

  if (changesResult.data) {
    printError(
      'Error: Worktree has uncommitted changes. Commit or stash them first.'
    );
    process.exit(1);
  }

  print(`Removing worktree for "${branch}"...`);

  const result = await removeWorktree(repo.path, worktree.path);
  if (!result.success) {
    printError(`Error: ${result.error}`);
    process.exit(1);
  }

  print(`Removed worktree "${repo.name}-${branch}"`);
}
