import type { CommandContext } from '../cli.ts';
import { readConfig } from '../config.ts';
import { isGitRepo, listWorktrees } from '../git.ts';
import { print, printError } from '../output.ts';

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
        for (const wt of nonMainWorktrees) {
          print(`      ↳ ${wt.branch}: ${wt.path}`);
        }
      }
    }
  }
}
