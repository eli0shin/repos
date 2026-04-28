import { describe, expect, test } from 'bun:test';
import { getIndexedWorktrees } from '../src/worktree-index.ts';
import type { RepoEntry } from '../src/types.ts';
import type { WorktreeInfo } from '../src/git/index.ts';

describe('worktree indexes', () => {
  test('matches stacked tree print order', () => {
    const repo = {
      name: 'repo',
      url: '/tmp/source',
      path: '/tmp/repo.git',
      bare: true,
      stacks: [
        { parent: 'main', child: 'a' },
        { parent: 'a', child: 'b' },
        { parent: 'main', child: 'c' },
        { parent: 'c', child: 'd' },
        { parent: 'main', child: 'e' },
      ],
    } satisfies RepoEntry;
    const worktrees = [
      { path: '/tmp/repo.git-a', branch: 'a', isMain: false },
      { path: '/tmp/repo.git-b', branch: 'b', isMain: false },
      { path: '/tmp/repo.git-c', branch: 'c', isMain: false },
      { path: '/tmp/repo.git-d', branch: 'd', isMain: false },
      { path: '/tmp/repo.git-e', branch: 'e', isMain: false },
    ] satisfies WorktreeInfo[];

    expect(getIndexedWorktrees(repo, worktrees)).toEqual([
      {
        path: '/tmp/repo.git-a',
        branch: 'a',
        isMain: false,
        index: 1,
      },
      {
        path: '/tmp/repo.git-b',
        branch: 'b',
        isMain: false,
        index: 2,
      },
      {
        path: '/tmp/repo.git-c',
        branch: 'c',
        isMain: false,
        index: 3,
      },
      {
        path: '/tmp/repo.git-d',
        branch: 'd',
        isMain: false,
        index: 4,
      },
      {
        path: '/tmp/repo.git-e',
        branch: 'e',
        isMain: false,
        index: 5,
      },
    ]);
  });
});
