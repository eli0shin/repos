import type { CommandContext } from '../cli.ts';
import { readConfig } from '../config.ts';
import { isGitRepo, pullCurrentBranch } from '../git.ts';
import { print, printError } from '../output.ts';

type PullResult = {
  name: string;
  success: boolean;
  error?: string;
  updated?: boolean;
};

export async function latestCommand(ctx: CommandContext): Promise<void> {
  const configResult = await readConfig(ctx.configPath);
  if (!configResult.success) {
    printError(`Error reading config: ${configResult.error}`);
    process.exit(1);
  }

  const { repos } = configResult.data;

  if (repos.length === 0) {
    print('No repos in config. Use "repos add <url>" to add one.');
    return;
  }

  print(`Pulling ${repos.length} repo(s) in parallel...\n`);

  const pullPromises = repos.map(async (repo): Promise<PullResult> => {
    if (!(await isGitRepo(repo.path))) {
      return { name: repo.name, success: false, error: 'not cloned' };
    }

    const pullResult = await pullCurrentBranch(repo.path);
    if (!pullResult.success) {
      return { name: repo.name, success: false, error: pullResult.error };
    }

    return {
      name: repo.name,
      success: true,
      updated: pullResult.data.updated,
    };
  });

  const results = await Promise.all(pullPromises);

  for (const result of results) {
    if (result.success) {
      const status = result.updated ? 'updated' : 'up to date';
      print(`  ✓ ${result.name}: ${status}`);
    } else {
      print(`  ✗ ${result.name}: ${result.error}`);
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  print(`\nPulled ${succeeded} repo(s), ${failed} failed`);
}
