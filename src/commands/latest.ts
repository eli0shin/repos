import { join } from 'node:path';
import { readConfig, writeConfig, updateRepoBranch } from '../config.ts';
import { isGitRepo, getCurrentBranch, pullCurrentBranch } from '../git.ts';
import { print, printError } from '../output.ts';
import type { ReposConfig } from '../types.ts';

type LatestContext = {
  codeDir: string;
  configPath: string;
};

type PullResult = {
  name: string;
  success: boolean;
  error?: string;
  updated?: boolean;
  branch?: string;
  branchChanged?: boolean;
};

export async function latestCommand(ctx: LatestContext): Promise<void> {
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
    const repoPath = join(ctx.codeDir, repo.name);

    if (!(await isGitRepo(repoPath))) {
      return { name: repo.name, success: false, error: 'not cloned' };
    }

    const pullResult = await pullCurrentBranch(repoPath);
    if (!pullResult.success) {
      return { name: repo.name, success: false, error: pullResult.error };
    }

    const branchResult = await getCurrentBranch(repoPath);
    if (!branchResult.success) {
      return {
        name: repo.name,
        success: true,
        updated: pullResult.data.updated,
      };
    }

    return {
      name: repo.name,
      success: true,
      updated: pullResult.data.updated,
      branch: branchResult.data,
      branchChanged: branchResult.data !== repo.branch,
    };
  });

  const results = await Promise.all(pullPromises);

  let config: ReposConfig = configResult.data;
  let configChanged = false;

  for (const result of results) {
    if (result.success) {
      const status = result.updated ? 'updated' : 'up to date';
      const branchInfo = result.branchChanged
        ? ` (branch changed to ${result.branch})`
        : '';
      print(`  ✓ ${result.name}: ${status}${branchInfo}`);

      if (result.branchChanged && result.branch) {
        config = updateRepoBranch(config, result.name, result.branch);
        configChanged = true;
      }
    } else {
      print(`  ✗ ${result.name}: ${result.error}`);
    }
  }

  if (configChanged) {
    const writeResult = await writeConfig(ctx.configPath, config);
    if (!writeResult.success) {
      printError(`\nError saving config: ${writeResult.error}`);
      process.exit(1);
    }
    print('\nConfig updated with new branch names');
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  print(`\nPulled ${succeeded} repo(s), ${failed} failed`);
}
