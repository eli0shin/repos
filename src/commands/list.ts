import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  getParentBranch,
  getChildBranches,
  findRepoFromCwd,
} from '../config.ts';
import { isGitRepoOrBare, listWorktrees } from '../git/index.ts';
import type { WorktreeInfo } from '../git/index.ts';
import type { PullRequestInfo } from '../github.ts';
import * as github from '../github.ts';
import type { RepoEntry } from '../types.ts';
import { print } from '../output.ts';
import { getIndexedWorktrees, getRootWorktrees } from '../worktree-index.ts';

type PrintRepoOptions = {
  showIndexes: boolean;
};

type PrInfoByPath = Map<string, PullRequestInfo | undefined>;

function formatPrLabel(prInfo: PullRequestInfo): string {
  const urlLabel = prInfo.url ? ` ${prInfo.url}` : '';
  return `(PR ${prInfo.status})${urlLabel}`;
}

function printWorktreeTree(
  repo: RepoEntry,
  worktrees: WorktreeInfo[],
  branch: string,
  indent: string,
  isLast: boolean,
  indexByPath?: Map<string, number>,
  prInfoByPath?: PrInfoByPath
): void {
  const wt = worktrees.find((w) => w.branch === branch);
  if (!wt) return;

  const prefix = indent + (isLast ? '└─ ' : '├─ ');
  const parentBranch = getParentBranch(repo, branch);
  const stackedLabel = parentBranch ? ' (stacked)' : '';
  const prInfo = prInfoByPath?.get(wt.path);
  const index = indexByPath?.get(wt.path);
  const indexLabel = index ? `[${index}] ` : '';
  print(`${prefix}${indexLabel}${wt.branch}: ${wt.path}${stackedLabel}`);
  if (prInfo) {
    print(`${indent}     ${formatPrLabel(prInfo)}`);
  }

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
      indexByPath,
      prInfoByPath
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
      const indexByPath = options.showIndexes
        ? new Map(
            getIndexedWorktrees(repo, nonMainWorktrees).map((wt) => [
              wt.path,
              wt.index,
            ])
          )
        : undefined;
      const prInfoEntries = await Promise.all(
        nonMainWorktrees.map(
          async (wt) =>
            [
              wt.path,
              wt.branch
                ? await github.getPullRequestStatus(wt.path, wt.branch)
                : undefined,
            ] as const
        )
      );
      const prInfoByPath: PrInfoByPath = new Map(prInfoEntries);

      // Print each root and its children
      rootWorktrees.forEach((wt, index) => {
        printWorktreeTree(
          repo,
          nonMainWorktrees,
          wt.branch,
          '      ',
          index === rootWorktrees.length - 1,
          indexByPath,
          prInfoByPath
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
