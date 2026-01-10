import type { CommandContext } from '../cli.ts';
import { readConfig, getParentBranch, getChildBranches } from '../config.ts';
import { isGitRepo, listWorktrees } from '../git.ts';
import type { WorktreeInfo } from '../git.ts';
import type { RepoEntry } from '../types.ts';
import { print, printError } from '../output.ts';

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

export async function listCommand(ctx: CommandContext): Promise<void> {
  const result = await readConfig(ctx.configPath);

  if (!result.success) {
    printError(`Error reading config: ${result.error}`);
    process.exit(1);
  }

  const { repos } = result.data;

  if (repos.length === 0) {
    print('No repos tracked. Use "repos add <url>" to add one.');
    return;
  }

  print('Tracked repositories:\n');

  for (const repo of repos) {
    const exists = await isGitRepo(repo.path);
    const bareLabel = repo.bare ? ' (bare)' : '';
    const status = exists ? '✓' : '✗ not cloned';

    print(`  ${repo.name}${bareLabel} ${status}`);
    print(`    ${repo.path}`);

    // Show worktrees if repo exists
    if (exists) {
      const worktreesResult = await listWorktrees(repo.path);
      if (worktreesResult.success) {
        const nonMainWorktrees = worktreesResult.data.filter(
          (wt) => !wt.isMain
        );

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
}
