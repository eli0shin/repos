import type { OperationResult } from '../types.ts';
import { runGitCommand } from './core.ts';
import { getMergeBase } from './commit.ts';

export type RefreshBaseRefResult =
  | { success: true; data: string; message?: string; warning?: string }
  | { success: false; error: string };

// Base ref helpers for stacked branch fork point tracking
// These refs store the commit hash of the parent branch at the time of stacking
// to enable correct rebase --onto behavior after parent is rebased/squashed

export async function getBaseRef(
  repoDir: string,
  branch: string
): Promise<OperationResult<string>> {
  const result = await runGitCommand(
    ['rev-parse', `refs/bases/${branch}`],
    repoDir
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: `No base ref found for branch "${branch}"`,
    };
  }

  return { success: true, data: result.stdout.trim() };
}

export async function setBaseRef(
  repoDir: string,
  branch: string,
  commit: string
): Promise<OperationResult> {
  const result = await runGitCommand(
    ['update-ref', `refs/bases/${branch}`, commit],
    repoDir
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to set base ref',
    };
  }

  return { success: true, data: undefined };
}

export async function deleteBaseRef(
  repoDir: string,
  branch: string
): Promise<OperationResult> {
  const result = await runGitCommand(
    ['update-ref', '-d', `refs/bases/${branch}`],
    repoDir
  );

  // Ignore errors if ref doesn't exist
  if (result.exitCode !== 0 && !result.stderr.includes('not found')) {
    return {
      success: false,
      error: result.stderr || 'Failed to delete base ref',
    };
  }

  return { success: true, data: undefined };
}

export async function computeForkPoint(
  repoDir: string,
  childBranch: string,
  parentBranch: string
): Promise<OperationResult<string>> {
  // Get commits in child not reachable from parent
  // This only works correctly BEFORE parent is rebased
  const log = await runGitCommand(
    ['log', `${parentBranch}..${childBranch}`, '--format=%H'],
    repoDir
  );

  if (log.exitCode !== 0) {
    return {
      success: false,
      error: log.stderr || 'Failed to compute fork point',
    };
  }

  const commits = log.stdout.trim().split('\n').filter(Boolean);

  if (commits.length === 0) {
    // No unique commits, fork point is the parent branch
    const parentHead = await runGitCommand(
      ['rev-parse', parentBranch],
      repoDir
    );
    if (parentHead.exitCode !== 0) {
      return { success: false, error: 'Failed to resolve parent branch' };
    }
    return { success: true, data: parentHead.stdout.trim() };
  }

  // The fork point is the parent of the oldest unique commit
  const oldest = commits[commits.length - 1];
  const forkPoint = await runGitCommand(['rev-parse', `${oldest}^`], repoDir);

  if (forkPoint.exitCode !== 0) {
    return {
      success: false,
      error: forkPoint.stderr || 'Failed to get fork point parent',
    };
  }

  return { success: true, data: forkPoint.stdout.trim() };
}

/**
 * Check if a commit is an ancestor of another commit.
 * Returns false both when the answer is "no" and when git errors (e.g. invalid ref).
 */
async function isAncestor(
  repoDir: string,
  maybeAncestor: string,
  descendant: string
): Promise<boolean> {
  const result = await runGitCommand(
    ['merge-base', '--is-ancestor', maybeAncestor, descendant],
    repoDir
  );
  return result.exitCode === 0;
}

/**
 * Validate and refresh a stored base ref for a stacked branch.
 *
 * The stored base ref can become stale when:
 * - The child branch was rebased manually (e.g., `git rebase parent`)
 * - The parent branch was amended/rebased and commits drifted
 *
 * This function computes `git merge-base parent child` and compares it
 * with the stored base ref. If the merge-base is more recent (a descendant
 * of the stored ref), the child has been rebased forward and we use the
 * merge-base instead. This prevents replaying commits already on the parent.
 *
 * Spawns up to 3 git child processes: getMergeBase + up to 2 isAncestor calls.
 * In the common case (no staleness) the cost is getMergeBase + 1 isAncestor.
 */
export async function refreshBaseRef(
  repoDir: string,
  childBranch: string,
  parentBranch: string
): Promise<RefreshBaseRefResult> {
  const storedResult = await getBaseRef(repoDir, childBranch);
  if (!storedResult.success) {
    return storedResult;
  }

  const storedRef = storedResult.data;

  // Compute the actual current merge-base between parent and child
  const mergeBaseResult = await getMergeBase(
    repoDir,
    parentBranch,
    childBranch
  );
  if (!mergeBaseResult.success) {
    // Can't compute merge-base, fall back to stored ref
    return { success: true, data: storedRef };
  }

  const mergeBase = mergeBaseResult.data;

  // If merge-base equals stored ref, nothing to do
  if (mergeBase === storedRef) {
    return { success: true, data: storedRef };
  }

  // Check if merge-base is a descendant of stored ref.
  // This means the child was rebased forward (e.g., manually) and
  // the stored ref is now too far back.
  const mergeBaseIsNewer = await isAncestor(repoDir, storedRef, mergeBase);
  if (mergeBaseIsNewer) {
    const setResult = await setBaseRef(repoDir, childBranch, mergeBase);
    return {
      success: true,
      data: mergeBase,
      message: `Resynced fork point for "${childBranch}" (was stale)`,
      warning: setResult.success
        ? undefined
        : `Failed to persist resynced fork point: ${setResult.error}`,
    };
  }

  // Check if stored ref is not an ancestor of child at all (orphaned)
  const storedIsValid = await isAncestor(repoDir, storedRef, childBranch);
  if (!storedIsValid) {
    const setResult = await setBaseRef(repoDir, childBranch, mergeBase);
    return {
      success: true,
      data: mergeBase,
      message: `Resynced fork point for "${childBranch}" (was orphaned)`,
      warning: setResult.success
        ? undefined
        : `Failed to persist resynced fork point: ${setResult.error}`,
    };
  }

  // Stored ref is still valid and more precise, keep it
  return { success: true, data: storedRef };
}
