import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  findRepoFromCwd,
  getParentBranch,
  getChildBranches,
} from '../config.ts';
import { restackTree, type RestackContext } from './restack.ts';
import {
  listWorktrees,
  findWorktreeByDirectory,
  findWorktreeByBranch,
  isRebaseInProgress,
  getRebaseBranch,
  rebaseContinue,
  setBaseRef,
  deleteBaseRef,
  getHeadCommit,
  runGitCommand,
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

  if (!currentWorktree) {
    printError('Error: Not inside a worktree. Run from inside a worktree.');
    process.exit(1);
  }

  // Check if a rebase is in progress
  const rebaseActive = await isRebaseInProgress(currentWorktree.path);
  if (!rebaseActive) {
    printError('Error: No rebase in progress.');
    process.exit(1);
  }

  // Get the branch name - during a rebase HEAD is detached so worktree.branch is empty
  let currentBranch = currentWorktree.branch;
  if (!currentBranch) {
    const rebaseBranchResult = await getRebaseBranch(currentWorktree.path);
    if (!rebaseBranchResult.success) {
      printError('Error: Could not determine current branch.');
      process.exit(1);
    }
    currentBranch = rebaseBranchResult.data;
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

    let parentHead: string;
    if (parentWorktree) {
      const parentHeadResult = await getHeadCommit(parentWorktree.path);
      if (!parentHeadResult.success) {
        printError(
          `Error: Failed to get parent HEAD: ${parentHeadResult.error}`
        );
        process.exit(1);
      }
      parentHead = parentHeadResult.data;
    } else {
      // Parent worktree doesn't exist, resolve branch ref from main repo
      const parentRefResult = await runGitCommand(
        ['rev-parse', parentBranch],
        repo.path
      );
      if (parentRefResult.exitCode === 0) {
        parentHead = parentRefResult.stdout.trim();
      } else {
        // Parent branch is gone, delete the base ref
        await deleteBaseRef(repo.path, currentBranch);
        print('Parent branch no longer exists, removed fork point tracking.');
        print('Rebase completed successfully.');
        return;
      }
    }

    const setRefResult = await setBaseRef(repo.path, currentBranch, parentHead);
    if (!setRefResult.success) {
      printError(`Error: Failed to update fork point: ${setRefResult.error}`);
      process.exit(1);
    }

    print('Updated fork point reference.');
  }

  print('Rebase completed successfully.');

  // Check for children to restack recursively
  const children = getChildBranches(repo, currentBranch);
  if (children.length > 0) {
    // Reload worktrees since the rebase may have changed things
    const freshWorktreesResult = await listWorktrees(repo.path);
    if (!freshWorktreesResult.success) {
      printError(`Error: ${freshWorktreesResult.error}`);
      process.exit(1);
    }

    // Check if any children have worktrees
    const childrenWithWorktrees = children.filter((child) =>
      findWorktreeByBranch(freshWorktreesResult.data, child)
    );

    if (childrenWithWorktrees.length > 0) {
      print(`Restacking ${childrenWithWorktrees.length} child branch(es)...`);

      const rctx = {
        ctx,
        repo,
        config,
        worktrees: freshWorktreesResult.data,
      } satisfies RestackContext;

      for (const child of childrenWithWorktrees) {
        const childSuccess = await restackTree(rctx, child);
        if (!childSuccess) {
          // Child has conflicts - user needs to resolve and continue again
          process.exit(1);
        }
      }
    }
  }
}
