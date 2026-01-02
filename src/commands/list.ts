import type { CommandContext } from '../cli.ts';
import { readConfig } from '../config.ts';
import { isGitRepo, getCurrentBranch } from '../git.ts';
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

    let status: string;
    let currentBranch = repo.branch;

    if (exists) {
      const branchResult = await getCurrentBranch(repo.path);
      if (branchResult.success) {
        currentBranch = branchResult.data;
      }
      status = currentBranch === repo.branch ? '✓' : `⚠ on ${currentBranch}`;
    } else {
      status = '✗ not cloned';
    }

    print(`  ${repo.name} (${repo.branch}) ${status}`);
    print(`    ${repo.path}`);
  }
}
