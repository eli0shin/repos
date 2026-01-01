import { join } from 'node:path';
import { readConfig } from '../config.ts';
import { isGitRepo, getCurrentBranch } from '../git.ts';
import { print, printError } from '../output.ts';

type ListContext = {
  codeDir: string;
  configPath: string;
};

export async function listCommand(ctx: ListContext): Promise<void> {
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
    const repoPath = join(ctx.codeDir, repo.name);
    const exists = await isGitRepo(repoPath);

    let status: string;
    let currentBranch = repo.branch;

    if (exists) {
      const branchResult = await getCurrentBranch(repoPath);
      if (branchResult.success) {
        currentBranch = branchResult.data;
      }
      status = currentBranch === repo.branch ? '✓' : `⚠ on ${currentBranch}`;
    } else {
      status = '✗ not cloned';
    }

    print(`  ${repo.name} (${repo.branch}) ${status}`);
    print(`    ${repo.url}`);
  }
}
