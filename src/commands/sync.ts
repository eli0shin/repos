import { join } from 'node:path';
import {
  readConfig,
  writeConfig,
  addRepoToConfig,
  findRepo,
} from '../config.ts';
import {
  findGitRepos,
  getCurrentBranch,
  getRemoteUrl,
  cloneRepo,
  isGitRepo,
} from '../git.ts';
import { print, printError } from '../output.ts';
import type { ReposConfig } from '../types.ts';

type SyncContext = {
  codeDir: string;
  configPath: string;
};

export async function syncCommand(ctx: SyncContext): Promise<void> {
  const configResult = await readConfig(ctx.configPath);
  if (!configResult.success) {
    printError(`Error reading config: ${configResult.error}`);
    process.exit(1);
  }

  let config: ReposConfig = configResult.data;
  let adopted = 0;
  let cloned = 0;

  print('Scanning for untracked repos...\n');

  const repoNames = await findGitRepos(ctx.codeDir);
  const newRepos = repoNames.filter((name) => !findRepo(config, name));

  for (const name of newRepos) {
    const repoPath = join(ctx.codeDir, name);

    const urlResult = await getRemoteUrl(repoPath);
    if (!urlResult.success) {
      print(`  ✗ ${name}: no remote origin`);
      continue;
    }

    const branchResult = await getCurrentBranch(repoPath);
    if (!branchResult.success) {
      print(`  ✗ ${name}: couldn't get branch`);
      continue;
    }

    config = addRepoToConfig(config, {
      name,
      url: urlResult.data,
      branch: branchResult.data,
    });

    print(`  ✓ adopted ${name} (${branchResult.data})`);
    adopted++;
  }

  print('\nCloning missing repos...\n');

  for (const repo of config.repos) {
    const targetDir = join(ctx.codeDir, repo.name);

    if (await isGitRepo(targetDir)) {
      continue;
    }

    print(`  Cloning ${repo.name}...`);
    const result = await cloneRepo(repo.url, targetDir);
    if (!result.success) {
      print(`  ✗ ${repo.name}: ${result.error}`);
      continue;
    }
    print(`  ✓ cloned ${repo.name}`);
    cloned++;
  }

  if (adopted > 0) {
    const writeResult = await writeConfig(ctx.configPath, config);
    if (!writeResult.success) {
      printError(`\nError saving config: ${writeResult.error}`);
      process.exit(1);
    }
  }

  print(`\nSync complete: adopted ${adopted}, cloned ${cloned}`);
}
