import { join } from 'node:path';
import {
  readConfig,
  writeConfig,
  addRepoToConfig,
  findRepo,
} from '../config.ts';
import { findGitRepos, getCurrentBranch, getRemoteUrl } from '../git.ts';
import { print, printError } from '../output.ts';
import type { ReposConfig } from '../types.ts';

type AdoptContext = {
  codeDir: string;
  configPath: string;
};

export async function adoptCommand(ctx: AdoptContext): Promise<void> {
  const configResult = await readConfig(ctx.configPath);
  if (!configResult.success) {
    printError(`Error reading config: ${configResult.error}`);
    process.exit(1);
  }

  const repoNames = await findGitRepos(ctx.codeDir);

  if (repoNames.length === 0) {
    print('No git repos found in directory');
    return;
  }

  const newRepos = repoNames.filter(
    (name) => !findRepo(configResult.data, name)
  );

  if (newRepos.length === 0) {
    print('All repos are already tracked');
    return;
  }

  print(`Found ${newRepos.length} untracked repo(s)\n`);

  let config: ReposConfig = configResult.data;
  let adopted = 0;

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

    print(`  ✓ ${name} (${branchResult.data})`);
    adopted++;
  }

  if (adopted > 0) {
    const writeResult = await writeConfig(ctx.configPath, config);
    if (!writeResult.success) {
      printError(`\nError saving config: ${writeResult.error}`);
      process.exit(1);
    }
  }

  print(`\nAdopted ${adopted} repo(s)`);
}
