import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  getParentBranch,
  getChildBranches,
  findRepoFromCwd,
} from '../config.ts';
import { isGitRepoOrBare, listWorktrees } from '../git.ts';
import type { WorktreeInfo } from '../git.ts';
import type { RepoEntry } from '../types.ts';
import { print } from '../output.ts';

function printWorktreeTree(
  repo: RepoEntry,
  worktrees: WorktreeInfo[],
  branch: string,
  indent: string,
  isLast: boolean
): void {
  const wt = worktrees.find((w) => w.branch === branch);
  if (!wt) return;

  const prefix = indent + (isLast ? '└─ ' : '├─ ');
  const parentBranch = getParentBranch(repo, branch);
  const stackedLabel = parentBranch ? ' (stacked)' : '';
  print(`${prefix}${wt.branch}: ${wt.path}${stackedLabel}`);

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
      index === children.length - 1
    );
  });
}

async function printRepo(repo: RepoEntry): Promise<void> {
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

      // Find root worktrees (no parent or parent not in worktrees)
      const rootWorktrees = nonMainWorktrees.filter((wt) => {
        const parent = getParentBranch(repo, wt.branch);
        return !parent || !nonMainWorktrees.some((w) => w.branch === parent);
      });

      // Print each root and its children
      rootWorktrees.forEach((wt, index) => {
        printWorktreeTree(
          repo,
          nonMainWorktrees,
          wt.branch,
          '      ',
          index === rootWorktrees.length - 1
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
    await printRepo(currentRepo);
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
