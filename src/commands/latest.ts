import type { CommandContext } from '../cli.ts';
import { readConfigOrExit } from '../config.ts';
import {
  isGitRepo,
  isBareRepo,
  pullCurrentBranch,
  fetchOrigin,
} from '../git.ts';
import { print } from '../output.ts';

type UpdateResult = {
  name: string;
  success: boolean;
  error?: string;
  updated?: boolean;
  fetched?: boolean;
};

export async function latestCommand(ctx: CommandContext): Promise<void> {
  const config = await readConfigOrExit(ctx.configPath);
  const { repos } = config;

  if (repos.length === 0) {
    print('No repos in config. Use "repos add <url>" to add one.');
    return;
  }

  print(`Updating ${repos.length} repo(s) in parallel...\n`);

  const promises = repos.map(async (repo): Promise<UpdateResult> => {
    if (repo.bare) {
      if (!(await isBareRepo(repo.path))) {
        return { name: repo.name, success: false, error: 'not cloned' };
      }

      const fetchResult = await fetchOrigin(repo.path);
      if (!fetchResult.success) {
        return { name: repo.name, success: false, error: fetchResult.error };
      }

      return { name: repo.name, success: true, fetched: true };
    }

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

  const results = await Promise.all(promises);

  for (const result of results) {
    if (result.success) {
      if (result.fetched) {
        print(`  ✓ ${result.name}: fetched`);
      } else {
        const status = result.updated ? 'updated' : 'up to date';
        print(`  ✓ ${result.name}: ${status}`);
      }
    } else {
      print(`  ✗ ${result.name}: ${result.error}`);
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  print(`\nUpdated ${succeeded} repo(s), ${failed} failed`);
}
