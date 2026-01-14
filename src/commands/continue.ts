import type { CommandContext } from '../cli.ts';
import { loadConfig, findRepoFromCwd, getParentBranch } from '../config.ts';
import {
  listWorktrees,
  findWorktreeByDirectory,
  findWorktreeByBranch,
  isRebaseInProgress,
  rebaseContinue,
  setBaseRef,
  getHeadCommit,
} from '../git.ts';
import { print, printError } from '../output.ts';

export async function continueCommand(ctx: CommandContext): Promise<void> {
  const config = await loadConfig(ctx.configPath);

  // Find repo from current working directory
  const repo = await findRepoFromCwd(config, process.cwd());
  if (!repo) {
    printError('Error: Not inside a tracked repo.');
    process.exit(1);
  }

  // List worktrees to find current branch
  const worktreesResult = await listWorktrees(repo.path);
  if (!worktreesResult.success) {
    printError(`Error: ${worktreesResult.error}`);
    process.exit(1);
  }

  // Find the worktree we're currently in
  const currentWorktree = findWorktreeByDirectory(
    worktreesResult.data,
    process.cwd()
  );

  if (!currentWorktree?.branch) {
    printError('Error: Not inside a worktree. Run from inside a worktree.');
    process.exit(1);
  }

  const currentBranch = currentWorktree.branch;

  // Check if a rebase is in progress
  const rebaseActive = await isRebaseInProgress(currentWorktree.path);
  if (!rebaseActive) {
    printError('Error: No rebase in progress.');
    process.exit(1);
  }

  print('Continuing rebase...');

  // Continue the rebase
  const continueResult = await rebaseContinue(currentWorktree.path);
  if (!continueResult.success) {
    printError(`Error: ${continueResult.error}`);
    process.exit(1);
  }

  // Update the base ref if this is a stacked branch
  const parentBranch = getParentBranch(repo, currentBranch);
  if (parentBranch) {
    const parentWorktree = findWorktreeByBranch(
      worktreesResult.data,
      parentBranch
    );

    if (parentWorktree) {
      const parentHeadResult = await getHeadCommit(parentWorktree.path);
      if (parentHeadResult.success) {
        const setRefResult = await setBaseRef(
          repo.path,
          currentBranch,
          parentHeadResult.data
        );
        if (setRefResult.success) {
          print('Updated fork point reference.');
        }
      }
    }
  }

  print('Rebase completed successfully.');
}
