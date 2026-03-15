import type { CommandContext } from '../cli.ts';
import { readConfigOrExit } from '../config.ts';
import { isGitRepoOrBare, listWorktrees } from '../git.ts';
import { print } from '../output.ts';

export async function listCommand(ctx: CommandContext): Promise<void> {
  const config = await readConfigOrExit(ctx.configPath);
  const { repos } = config;

  if (repos.length === 0) {
    print('No repos tracked. Use "repos add <url>" to add one.');
    return;
  }

  print('Tracked repositories:\n');

  for (const repo of repos) {
    const exists = await isGitRepoOrBare(repo.path);
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
        for (const wt of nonMainWorktrees) {
          print(`      ↳ ${wt.branch}: ${wt.path}`);
        }
      }
    }
  }
}
