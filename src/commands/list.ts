import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  getParentBranch,
  getChildBranches,
  findRepoFromCwd,
} from '../config.ts';
import { isGitRepoOrBare, listWorktrees } from '../git/index.ts';
import type { WorktreeInfo } from '../git/index.ts';
import type { RepoEntry } from '../types.ts';
import { print } from '../output.ts';

export type IndexedWorktree = WorktreeInfo & { index: number };

type PrintRepoOptions = {
  showIndexes: boolean;
};

function getRootWorktrees(
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
  const nonMainWorktrees = worktrees.filter((wt) => !wt.isMain);
  const rootWorktrees = getRootWorktrees(repo, nonMainWorktrees);
  const indexed: IndexedWorktree[] = [];

  rootWorktrees.forEach((wt) => {
    appendIndexedWorktreeTree(repo, nonMainWorktrees, wt.branch, indexed);
  });

  return indexed;
}

function printWorktreeTree(
  repo: RepoEntry,
  worktrees: WorktreeInfo[],
  branch: string,
  indent: string,
  isLast: boolean,
  indexedWorktrees?: IndexedWorktree[]
): void {
  const wt = worktrees.find((w) => w.branch === branch);
  if (!wt) return;

  const prefix = indent + (isLast ? '└─ ' : '├─ ');
  const parentBranch = getParentBranch(repo, branch);
  const stackedLabel = parentBranch ? ' (stacked)' : '';
  const indexed = indexedWorktrees?.find(
    (indexedWt) => indexedWt.path === wt.path
  );
  const indexLabel = indexed ? `[${indexed.index}] ` : '';
  print(`${prefix}${indexLabel}${wt.branch}: ${wt.path}${stackedLabel}`);

  const children = getChildBranches(repo, branch).filter((child) =>
    worktrees.some((w) => w.branch === child)
  );

  const newIndent = indent + (isLast ? '   ' : '│  ');
  children.forEach((child, index) => {
    printWorktreeTree(
      repo,
      worktrees,
      child,
      newIndent,
      index === children.length - 1,
      indexedWorktrees
    );
  });
}

async function printRepo(
  repo: RepoEntry,
  options: PrintRepoOptions = { showIndexes: false }
): Promise<void> {
  const exists = await isGitRepoOrBare(repo.path);
  const bareLabel = repo.bare ? ' (bare)' : '';
  const status = exists ? '✓' : '✗ not cloned';

  print(`  ${repo.name}${bareLabel} ${status}`);
  print(`    ${repo.path}`);

  // Show worktrees if repo exists
  if (exists) {
    const worktreesResult = await listWorktrees(repo.path);
    if (worktreesResult.success) {
      const nonMainWorktrees = worktreesResult.data.filter((wt) => !wt.isMain);
      const rootWorktrees = getRootWorktrees(repo, nonMainWorktrees);
      const indexedWorktrees = options.showIndexes
        ? getIndexedWorktrees(repo, worktreesResult.data)
        : undefined;

      // Print each root and its children
      rootWorktrees.forEach((wt, index) => {
        printWorktreeTree(
          repo,
          nonMainWorktrees,
          wt.branch,
          '      ',
          index === rootWorktrees.length - 1,
          indexedWorktrees
        );
      });
    }
  }
}

export async function listCommand(ctx: CommandContext): Promise<void> {
  const config = await loadConfig(ctx.configPath);

  const { repos } = config;

  // Detect if we're inside a tracked repo
  const currentRepo = await findRepoFromCwd(config, process.cwd());

  if (currentRepo) {
    // Inside a tracked repo - show only this repo
    await printRepo(currentRepo, { showIndexes: true });
  } else {
    // Not inside a tracked repo - show all repos
    if (repos.length === 0) {
      print('No repos tracked. Use "repos add <url>" to add one.');
      return;
    }

    print('Tracked repositories:\n');

    for (const repo of repos) {
      await printRepo(repo);
    }
  }
}
