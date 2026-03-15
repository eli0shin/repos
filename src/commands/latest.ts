import type { CommandContext } from '../cli.ts';
import { loadConfig } from '../config.ts';
import {
  isGitRepo,
  isBareRepo,
  pullCurrentBranch,
  fetchOrigin,
} from '../git/index.ts';
import { print } from '../output.ts';

type UpdateResult =
  | {
      name: string;
      success: true;
      status: 'updated' | 'up-to-date' | 'fetched';
    }
  | { name: string; success: false; error: string };

export async function latestCommand(ctx: CommandContext): Promise<void> {
  const config = await loadConfig(ctx.configPath);
  const { repos } = config;

  if (repos.length === 0) {
    print('No repos in config. Use "repos add <url>" to add one.');
    return;
  }

  print(`Updating ${repos.length} repo(s) in parallel...\n`);

  const promises = repos.map(async (repo): Promise<UpdateResult> => {
    // Bare repos: fetch only (no working tree to pull into)
    if (repo.bare) {
      if (!(await isBareRepo(repo.path))) {
        return { name: repo.name, success: false, error: 'not cloned' };
      }

      const fetchResult = await fetchOrigin(repo.path);
      if (!fetchResult.success) {
        return { name: repo.name, success: false, error: fetchResult.error };
      }

      return { name: repo.name, success: true, status: 'fetched' };
    }

    // Regular repos: pull
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
      status: pullResult.data.updated ? 'updated' : 'up-to-date',
    };
  });

  const results = await Promise.all(promises);

  for (const result of results) {
    if (result.success) {
      const label =
        result.status === 'up-to-date' ? 'up to date' : result.status;
      print(`  ✓ ${result.name}: ${label}`);
    } else {
      print(`  ✗ ${result.name}: ${result.error}`);
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  print(`\nUpdated ${succeeded} repo(s), ${failed} failed`);
}
