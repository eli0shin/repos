import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  findRepoFromCwd,
  getParentBranch,
  getChildBranches,
  removeStackEntry,
  saveStackUpdate,
} from '../config.ts';
import type { RepoEntry, ReposConfig } from '../types.ts';
import {
  getDefaultBranch,
  listWorktrees,
  findWorktreeByDirectory,
  findWorktreeByBranch,
  fetchOrigin,
  rebaseOnto,
  rebaseOnRef,
  setBaseRef,
  deleteBaseRef,
  getHeadCommit,
  computeForkPoint,
  refreshBaseRef,
  resolveRef,
  type WorktreeInfo,
} from '../git/index.ts';
import { print, printError } from '../output.ts';

type RestackOptions = {
  only: boolean;
};

export type RestackContext = {
  ctx: CommandContext;
  repo: RepoEntry;
  config: ReposConfig;
  worktrees: WorktreeInfo[];
  /** Resolved once at the start of the restack run; undefined if resolution failed. */
  defaultBranch: string | undefined;
};

/**
 * Restack a single branch onto its parent.
 * Returns true if successful, false if failed (e.g., conflicts).
 */
async function restackBranch(
  rctx: RestackContext,
  branch: string
): Promise<boolean> {
  const { ctx, repo } = rctx;
  const { config, worktrees } = rctx;

  const worktree = findWorktreeByBranch(worktrees, branch);
  if (!worktree) {
    printError(`Error: No worktree found for branch "${branch}"`);
    return false;
  }

  const parentBranch = getParentBranch(repo, branch);
  if (!parentBranch) {
    printError(
      `Error: No parent branch recorded for "${branch}". Use "repos rebase" instead.`
    );
    return false;
  }

  // Check if parent branch still exists (has an active worktree)
  const parentWorktree = findWorktreeByBranch(worktrees, parentBranch);
  const parentStillExists = parentWorktree !== undefined;

  // Check if parent is the default branch (may not have a worktree in bare repos).
  // defaultBranch is resolved once per restack run (in restackCommand) and passed
  // via RestackContext to avoid redundant git calls for every branch in the chain.
  const defaultBranch = rctx.defaultBranch;
  const parentIsDefaultBranch = parentBranch === defaultBranch;

  // Determine target branch for rebase
  let targetRef: string;

  if (parentStillExists) {
    targetRef = parentBranch;
    print(`Rebasing "${branch}" on parent branch "${parentBranch}"...`);
  } else if (parentIsDefaultBranch) {
    // Parent is the default branch - rebase onto origin/{default} but keep stack
    targetRef = `origin/${defaultBranch}`;
    print(`Rebasing "${branch}" on "${defaultBranch}"...`);
  } else {
    // Parent is gone - fallback to default branch
    if (!defaultBranch) {
      printError('Error: Could not determine default branch');
      return false;
    }
    targetRef = `origin/${defaultBranch}`;

    // Remove the stale parent relationship
    const updatedRepo = removeStackEntry(repo, branch);
    await saveStackUpdate(ctx.configPath, config, updatedRepo);
    // Update context with new config
    const newConfig = await loadConfig(ctx.configPath);
    rctx.config = newConfig;

    print(
      `Parent "${parentBranch}" is gone. Rebasing "${branch}" on "${defaultBranch}"...`
    );
  }

  // Get fork point from base ref (refreshing if stale), or compute as fallback.
  // refreshBaseRef falls back to the stored ref when getMergeBase fails (e.g.,
  // parent branch is gone), so we can call it unconditionally.
  const baseRefResult = await refreshBaseRef(repo.path, branch, parentBranch);
  if (baseRefResult.success && baseRefResult.message) {
    print(baseRefResult.message);
  }
  if (baseRefResult.success && baseRefResult.warning) {
    printError(baseRefResult.warning);
  }
  let useForkPoint = false;
  let forkPoint: string | undefined;

  if (baseRefResult.success) {
    forkPoint = baseRefResult.data;
    useForkPoint = true;
  } else if (parentStillExists) {
    // No base ref exists but parent is available - compute fork point
    // This handles migration from stacks created before fork point tracking
    print('Computing fork point (no base ref found)...');
    print(
      'Note: If parent was recently rebased, the computed fork point may be incorrect.'
    );
    const computedResult = await computeForkPoint(
      worktree.path,
      branch,
      parentBranch
    );
    if (computedResult.success) {
      forkPoint = computedResult.data;
      useForkPoint = true;
      // Save the computed fork point for future restacks
      // This is important because computeForkPoint will give incorrect results
      // if the parent is later rebased/amended
      await setBaseRef(repo.path, branch, forkPoint);
    }
  }

  // Perform rebase
  let rebaseResult;
  if (useForkPoint && forkPoint) {
    rebaseResult = await rebaseOnto(worktree.path, targetRef, forkPoint);
  } else {
    rebaseResult = await rebaseOnRef(worktree.path, targetRef);
  }

  if (!rebaseResult.success) {
    printError(`Error: ${rebaseResult.error}`);
    return false;
  }

  // Update base ref to parent's current HEAD after successful rebase.
  //
  // Note on the two-condition structure: parentStillExists and parentIsDefaultBranch
  // can both be true simultaneously when the default branch has an active worktree
  // (non-bare repos). The first branch (parentWorktree) wins for base-ref updates,
  // using the live worktree HEAD via getHeadCommit. The else-if (parentIsDefaultBranch)
  // only fires when the default branch has NO worktree (bare repos or default branch
  // not checked out), so there is no overlap between the two branches in practice.
  if (parentWorktree) {
    const parentHeadResult = await getHeadCommit(parentWorktree.path);
    if (parentHeadResult.success) {
      await setBaseRef(repo.path, branch, parentHeadResult.data);
    }
  } else if (parentIsDefaultBranch) {
    // Parent is the default branch but has no worktree - update base ref to origin/{default} HEAD
    const revResult = await resolveRef(worktree.path, targetRef);
    if (revResult.success) {
      await setBaseRef(repo.path, branch, revResult.data);
    }
  } else {
    // Parent is gone, delete the base ref since we're no longer stacked
    await deleteBaseRef(repo.path, branch);
  }

  print(`Rebased "${branch}" on "${targetRef}"`);
  return true;
}

/**
 * Recursively restack a branch and all its children.
 */
export async function restackTree(
  rctx: RestackContext,
  branch: string
): Promise<boolean> {
  // First, restack this branch
  const success = await restackBranch(rctx, branch);
  if (!success) {
    return false;
  }

  // Reload config and worktrees since they may have changed.
  // Note: We mutate rctx in place intentionally. This is safe because:
  // 1. This code only runs after restackBranch succeeds (early return on failure above)
  // 2. If child recursion fails, we return false and exit - parent state doesn't matter
  // 3. The mutation propagates updated worktree list to subsequent sibling branches
  rctx.config = await loadConfig(rctx.ctx.configPath);
  const worktreesResult = await listWorktrees(rctx.repo.path);
  if (!worktreesResult.success) {
    printError(`Error: ${worktreesResult.error}`);
    return false;
  }
  rctx.worktrees = worktreesResult.data;

  // Find the updated repo entry
  const updatedRepo = rctx.config.repos.find((r) => r.path === rctx.repo.path);
  if (!updatedRepo) {
    printError('Error: Repository configuration was modified during restack.');
    return false;
  }
  rctx.repo = updatedRepo;

  // Get children of this branch and restack them
  const children = getChildBranches(rctx.repo, branch);
  for (const child of children) {
    // Check if child has a worktree
    const childWorktree = findWorktreeByBranch(rctx.worktrees, child);
    if (!childWorktree) {
      print(`Skipping "${child}" (no worktree)`);
      continue;
    }

    const childSuccess = await restackTree(rctx, child);
    if (!childSuccess) {
      // Stop on first failure - user needs to resolve conflicts
      return false;
    }
  }

  return true;
}

export async function restackCommand(
  ctx: CommandContext,
  options: RestackOptions = { only: false }
): Promise<void> {
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

  // Check if this branch has a parent (is stacked)
  const parentBranch = getParentBranch(repo, currentBranch);
  if (!parentBranch) {
    printError(
      `Error: No parent branch recorded for "${currentBranch}". Use "repos rebase" instead.`
    );
    process.exit(1);
  }

  // Fetch latest changes once at the start
  const fetchResult = await fetchOrigin(currentWorktree.path);
  if (!fetchResult.success) {
    printError(`Error fetching: ${fetchResult.error}`);
    process.exit(1);
  }

  // Resolve once here so restackBranch doesn't call getDefaultBranch per branch
  const defaultBranchResult = await getDefaultBranch(repo.path);
  const defaultBranch = defaultBranchResult.success
    ? defaultBranchResult.data
    : undefined;

  const rctx = {
    ctx,
    repo,
    config,
    worktrees: worktreesResult.data,
    defaultBranch,
  } satisfies RestackContext;

  let success: boolean;
  if (options.only) {
    // Only restack current branch
    success = await restackBranch(rctx, currentBranch);
  } else {
    // Restack current branch and all children recursively
    const children = getChildBranches(repo, currentBranch);
    if (children.length > 0) {
      print(
        `Will restack "${currentBranch}" and ${children.length} child branch(es)...`
      );
    }
    success = await restackTree(rctx, currentBranch);
  }

  if (!success) {
    process.exit(1);
  }
}
