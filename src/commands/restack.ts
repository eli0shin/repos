import type { CommandContext } from '../cli.ts';
import { loadConfig, resolveRepo } from '../config.ts';
import type { RepoEntry, ReposConfig } from '../types.ts';
import {
  getDefaultBranch,
  listWorktrees,
  findWorktreeByBranch,
  fetchOrigin,
  rebaseOnto,
  rebaseOnRef,
  getHeadCommit,
  resolveRef,
  resolveWorktree,
  isRebaseInProgress,
  markRebaseOnly,
  markRebaseRoot,
  runGitCommand,
  type WorktreeInfo,
} from '../git/index.ts';
import { print, printError } from '../output.ts';
import { resolveWorktreeIndex } from '../worktree-index.ts';
import {
  completeBranchRebase,
  getChildBranches,
  getParentBranch,
  recoverForkPoint,
  removeBranchStackParent,
  removeObsoleteForkPoint,
  resolveForkPoint,
} from '../branch-stack/index.ts';

type RebaseStackOptions = {
  only?: boolean;
  index?: number;
};

export type RestackContext = {
  ctx: CommandContext;
  repo: RepoEntry;
  config: ReposConfig;
  worktrees: WorktreeInfo[];
  /** Resolved once at the start of the rebase run; undefined if resolution failed. */
  defaultBranch: string | undefined;
  rootBranch?: string;
};

/**
 * Restack a single branch onto its parent.
 * Returns true if successful, false if failed (e.g., conflicts).
 */
async function restackBranch(
  rctx: RestackContext,
  branch: string,
  includeChildren = true
): Promise<boolean> {
  const { ctx, repo } = rctx;
  const { config, worktrees } = rctx;

  const worktree = findWorktreeByBranch(worktrees, branch);
  if (!worktree) {
    printError(`Error: No worktree found for branch "${branch}"`);
    return false;
  }

  const parentBranch = getParentBranch(repo, branch);

  // Check if parent branch still exists (has an active worktree)
  const parentWorktree = parentBranch
    ? findWorktreeByBranch(worktrees, parentBranch)
    : undefined;
  const parentStillExists = parentWorktree !== undefined;

  // Check if parent is the default branch (may not have a worktree in bare repos).
  // defaultBranch is resolved once per restack run (in restackCommand) and passed
  // via RestackContext to avoid redundant git calls for every branch in the chain.
  const defaultBranch = rctx.defaultBranch;
  const parentIsDefaultBranch =
    parentBranch === defaultBranch || parentBranch === undefined;

  // Determine target branch for rebase
  let targetRef: string;

  if (!parentBranch) {
    if (!defaultBranch) {
      printError('Error: Could not determine default branch');
      return false;
    }
    targetRef = `origin/${defaultBranch}`;
    print(`Rebasing "${branch}" on "${defaultBranch}"...`);
  } else if (parentStillExists) {
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
    const removal = await removeBranchStackParent(
      ctx.configPath,
      config,
      repo,
      branch
    );
    for (const warning of removal.warnings) {
      printError(warning);
    }
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
  const baseRefResult = await resolveForkPoint(
    repo.path,
    branch,
    parentBranch ?? targetRef
  );
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
  } else if (parentStillExists && parentBranch) {
    // No base ref exists but parent is available - compute fork point
    // This handles migration from stacks created before fork point tracking
    print('Computing fork point (no base ref found)...');
    print(
      'Note: If parent was recently rebased, the computed fork point may be incorrect.'
    );
    const computedResult = await recoverForkPoint(
      repo,
      worktree.path,
      branch,
      parentBranch
    );
    if (computedResult.success) {
      forkPoint = computedResult.data;
      useForkPoint = true;
      // The recovered Fork Point is persisted for future rebases because it
      // may no longer be recoverable after the parent is rebased or amended.
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
    if (await isRebaseInProgress(worktree.path)) {
      const markerResult = includeChildren
        ? await markRebaseRoot(worktree.path, rctx.rootBranch ?? branch)
        : await markRebaseOnly(worktree.path);
      if (!markerResult.success) {
        const abortResult = await runGitCommand(
          ['rebase', '--abort'],
          worktree.path
        );
        printError(
          `Error: Failed to preserve rebase state: ${markerResult.error}`
        );
        if (abortResult.exitCode === 0) {
          printError(
            'The rebase was aborted to avoid losing continuation state.'
          );
        } else {
          printError(`Failed to abort the rebase: ${abortResult.stderr}`);
        }
      }
    }
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
      const setResult = await completeBranchRebase(
        repo.path,
        branch,
        parentHeadResult.data
      );
      if (!setResult.success) {
        printError(`Warning: Failed to update fork point: ${setResult.error}`);
      }
    } else {
      printError(
        `Warning: Failed to resolve parent HEAD: ${parentHeadResult.error}`
      );
    }
  } else if (parentIsDefaultBranch) {
    // Parent is the default branch but has no worktree - update base ref to origin/{default} HEAD
    const revResult = await resolveRef(worktree.path, targetRef);
    if (revResult.success) {
      const setResult = await completeBranchRebase(
        repo.path,
        branch,
        revResult.data
      );
      if (!setResult.success) {
        printError(`Warning: Failed to update fork point: ${setResult.error}`);
      }
    } else {
      printError(`Warning: Failed to resolve ${targetRef}: ${revResult.error}`);
    }
  } else {
    // Parent is gone, delete the base ref since we're no longer stacked
    const deleteResult = await removeObsoleteForkPoint(repo.path, branch);
    if (!deleteResult.success) {
      printError(`Warning: Failed to remove fork point: ${deleteResult.error}`);
    }
  }

  print(`Rebased "${branch}" on "${targetRef}"`);
  return true;
}

export function getRebaseOrder(
  repo: RepoEntry,
  worktrees: WorktreeInfo[],
  rootBranch: string
): string[] {
  const branches: string[] = [];

  function visit(branch: string): void {
    branches.push(branch);
    for (const child of getChildBranches(repo, branch)) {
      if (findWorktreeByBranch(worktrees, child)) {
        visit(child);
      } else {
        print(`Skipping "${child}" (no worktree)`);
      }
    }
  }

  visit(rootBranch);
  return branches;
}

async function refreshRestackContext(rctx: RestackContext): Promise<boolean> {
  rctx.config = await loadConfig(rctx.ctx.configPath);
  const worktreesResult = await listWorktrees(rctx.repo.path);
  if (!worktreesResult.success) {
    printError(`Error: ${worktreesResult.error}`);
    return false;
  }
  rctx.worktrees = worktreesResult.data;

  const updatedRepo = rctx.config.repos.find((r) => r.path === rctx.repo.path);
  if (!updatedRepo) {
    printError('Error: Repository configuration was modified during rebase.');
    return false;
  }
  rctx.repo = updatedRepo;
  return true;
}

export async function rebaseBranches(
  rctx: RestackContext,
  branches: string[],
  rootBranch: string
): Promise<boolean> {
  rctx.rootBranch = rootBranch;
  for (const branch of branches) {
    if (!(await restackBranch(rctx, branch))) return false;
    if (!(await refreshRestackContext(rctx))) return false;
  }
  return true;
}

/** Rebase a branch and its descendants in depth-first order. */
export async function restackTree(
  rctx: RestackContext,
  branch: string
): Promise<boolean> {
  const branches = getRebaseOrder(rctx.repo, rctx.worktrees, branch);
  return rebaseBranches(rctx, branches, branch);
}

export async function rebaseStackCommand(
  ctx: CommandContext,
  branch?: string,
  repoName?: string,
  options: RebaseStackOptions = {}
): Promise<void> {
  const config = await loadConfig(ctx.configPath);
  const repo = await resolveRepo(config, repoName);

  if (options.index !== undefined && branch) {
    printError('Error: cannot specify both branch and --index');
    process.exit(1);
  }

  if (options.index !== undefined) {
    const indexedResult = await resolveWorktreeIndex(repo, options.index);
    if (!indexedResult.success) {
      printError(indexedResult.error);
      process.exit(1);
    }
    branch = indexedResult.data.branch;
  }

  const currentWorktree = await resolveWorktree(repo.path, branch);
  if (!currentWorktree.branch) {
    printError(
      'Error: Cannot rebase in detached HEAD state. Check out a branch first.'
    );
    process.exit(1);
  }
  const currentBranch = currentWorktree.branch;

  const worktreesResult = await listWorktrees(repo.path);
  if (!worktreesResult.success) {
    printError(`Error: ${worktreesResult.error}`);
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
    // Only rebase current branch
    success = await restackBranch(rctx, currentBranch, false);
  } else {
    // Restack current branch and all children recursively
    const children = getChildBranches(repo, currentBranch);
    if (children.length > 0) {
      print(
        `Will rebase "${currentBranch}" and ${children.length} child branch(es)...`
      );
    }
    success = await restackTree(rctx, currentBranch);
  }

  if (!success) {
    process.exit(1);
  }
}

export async function restackCommand(
  ctx: CommandContext,
  options: RebaseStackOptions = {}
): Promise<void> {
  printError('Warning: "repos restack" is deprecated; use "repos rebase".');
  await rebaseStackCommand(ctx, undefined, undefined, options);
}
