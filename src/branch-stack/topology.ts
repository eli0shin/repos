import type { RepoEntry } from '../types.ts';

export function getParentBranch(
  repo: RepoEntry,
  branch: string
): string | undefined {
  return repo.stacks?.find((stack) => stack.child === branch)?.parent;
}

export function getChildBranches(repo: RepoEntry, branch: string): string[] {
  return (
    repo.stacks
      ?.filter((stack) => stack.parent === branch)
      .map((stack) => stack.child) ?? []
  );
}

export function addStackEntry(
  repo: RepoEntry,
  parent: string,
  child: string
): RepoEntry {
  return {
    ...repo,
    stacks: [...(repo.stacks ?? []), { parent, child }],
  };
}

export function removeStackEntry(repo: RepoEntry, child: string): RepoEntry {
  if (!repo.stacks) return repo;

  const stacks = repo.stacks.filter((stack) => stack.child !== child);
  if (stacks.length === 0) {
    const { stacks: _, ...repoWithoutStacks } = repo;
    return repoWithoutStacks;
  }

  return { ...repo, stacks };
}

export function removeStackEntriesByParent(
  repo: RepoEntry,
  parent: string
): RepoEntry {
  if (!repo.stacks) return repo;

  const stacks = repo.stacks.filter((stack) => stack.parent !== parent);
  if (stacks.length === 0) {
    const { stacks: _, ...repoWithoutStacks } = repo;
    return repoWithoutStacks;
  }

  return { ...repo, stacks };
}
