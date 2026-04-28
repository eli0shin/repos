import { getChildBranches, getParentBranch } from './config.ts';
import type { WorktreeInfo } from './git/index.ts';
import type { RepoEntry } from './types.ts';

export type IndexedWorktree = WorktreeInfo & { index: number };

export function getRootWorktrees(
  repo: RepoEntry,
  worktrees: WorktreeInfo[]
): WorktreeInfo[] {
  return worktrees.filter((wt) => {
    const parent = getParentBranch(repo, wt.branch);
    return !parent || !worktrees.some((w) => w.branch === parent);
  });
}

function appendIndexedWorktreeTree(
  repo: RepoEntry,
  worktrees: WorktreeInfo[],
  branch: string,
  indexed: IndexedWorktree[]
): void {
  const wt = worktrees.find((w) => w.branch === branch);
  if (!wt) return;

  // Detached worktrees have no branch, so repos work cannot target them by name.
  if (wt.branch) {
    indexed.push({ ...wt, index: indexed.length + 1 });
  }

  const children = getChildBranches(repo, branch).filter((child) =>
    worktrees.some((w) => w.branch === child)
  );

  children.forEach((child) => {
    appendIndexedWorktreeTree(repo, worktrees, child, indexed);
  });
}

export function getIndexedWorktrees(
  repo: RepoEntry,
  worktrees: WorktreeInfo[]
): IndexedWorktree[] {
  const rootWorktrees = getRootWorktrees(repo, worktrees);
  const indexed: IndexedWorktree[] = [];

  rootWorktrees.forEach((wt) => {
    appendIndexedWorktreeTree(repo, worktrees, wt.branch, indexed);
  });

  return indexed;
}
