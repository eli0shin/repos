import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  findRepoFromCwd,
  getParentBranch,
  removeStackEntry,
  saveStackUpdate,
} from '../config.ts';
import {
  getRebaseOrder,
  rebaseBranches,
  type RestackContext,
} from './restack.ts';
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
  getDefaultBranch,
  shouldRebaseChildren,
  getRebaseRoot,
} from '../git/index.ts';
import { print, printError } from '../output.ts';

export async function continueCommand(ctx: CommandContext): Promise<void> {
  const config = await loadConfig(ctx.configPath);

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

  const includeChildren = await shouldRebaseChildren(currentWorktree.path);
  const rebaseRoot = await getRebaseRoot(currentWorktree.path);

  print('Continuing rebase...');

  // Continue the rebase
  const continueResult = await rebaseContinue(currentWorktree.path);
  if (!continueResult.success) {
    printError(`Error: ${continueResult.error}`);
    process.exit(1);
  }

  // Update the base ref to the branch's effective parent.
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
        // Parent branch is gone, remove the stale relationship and fork point.
        const updatedRepo = removeStackEntry(repo, currentBranch);
        const saveResult = await saveStackUpdate(
          ctx.configPath,
          config,
          updatedRepo
        );
        if (!saveResult.success) {
          printError('Error: Could not remove stale stack tracking.');
          process.exit(1);
        }
        const deleteResult = await deleteBaseRef(repo.path, currentBranch);
        if (!deleteResult.success) {
          printError(
            `Warning: Failed to remove fork point: ${deleteResult.error}`
          );
        }
        print('Parent branch no longer exists, removed stack tracking.');
        parentHead = '';
      }
    }

    if (parentHead) {
      const setRefResult = await setBaseRef(
        repo.path,
        currentBranch,
        parentHead
      );
      if (!setRefResult.success) {
        printError(`Error: Failed to update fork point: ${setRefResult.error}`);
        process.exit(1);
      }

      print('Updated fork point reference.');
    }
  } else {
    const defaultBranchResult = await getDefaultBranch(repo.path);
    if (defaultBranchResult.success) {
      const targetRef = `origin/${defaultBranchResult.data}`;
      const targetResult = await runGitCommand(
        ['rev-parse', targetRef],
        repo.path
      );
      if (targetResult.exitCode === 0) {
        const setRefResult = await setBaseRef(
          repo.path,
          currentBranch,
          targetResult.stdout.trim()
        );
        if (!setRefResult.success) {
          printError(
            `Error: Failed to update fork point: ${setRefResult.error}`
          );
          process.exit(1);
        }
        print('Updated fork point reference.');
      }
    }
  }

  print('Rebase completed successfully.');

  if (!includeChildren) return;

  const freshConfig = await loadConfig(ctx.configPath);
  const freshRepo = freshConfig.repos.find((entry) => entry.path === repo.path);
  if (!freshRepo) {
    printError('Error: Repository configuration was modified during rebase.');
    process.exit(1);
  }

  const freshWorktreesResult = await listWorktrees(repo.path);
  if (!freshWorktreesResult.success) {
    printError(`Error: ${freshWorktreesResult.error}`);
    process.exit(1);
  }

  const rootBranch = rebaseRoot ?? currentBranch;
  const rebaseOrder = getRebaseOrder(
    freshRepo,
    freshWorktreesResult.data,
    rootBranch
  );
  const currentIndex = rebaseOrder.indexOf(currentBranch);
  if (currentIndex < 0) {
    printError(
      `Error: Branch "${currentBranch}" is no longer in rebase tree "${rootBranch}".`
    );
    process.exit(1);
  }
  const remainingBranches = rebaseOrder.slice(currentIndex + 1);
  if (remainingBranches.length === 0) return;

  print(`Rebasing ${remainingBranches.length} remaining branch(es)...`);
  const defaultBranchResult = await getDefaultBranch(repo.path);
  const defaultBranch = defaultBranchResult.success
    ? defaultBranchResult.data
    : undefined;
  const rctx = {
    ctx,
    repo: freshRepo,
    config: freshConfig,
    worktrees: freshWorktreesResult.data,
    defaultBranch,
    rootBranch,
  } satisfies RestackContext;

  if (!(await rebaseBranches(rctx, remainingBranches, rootBranch))) {
    process.exit(1);
  }
}
