import { basename, join } from 'node:path';
import type { CommandContext } from '../cli.ts';
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
  isGitRepo,
} from '../git.ts';
import { print, printError } from '../output.ts';
import type { ReposConfig } from '../types.ts';

export async function adoptCommand(ctx: CommandContext): Promise<void> {
  const configResult = await readConfig(ctx.configPath);
  if (!configResult.success) {
    printError(`Error reading config: ${configResult.error}`);
    process.exit(1);
  }

  const cwd = process.cwd();

  // If current directory is a git repo, adopt just that repo
  if (await isGitRepo(cwd)) {
    await adoptSingleRepo(ctx.configPath, configResult.data, cwd);
    return;
  }

  // Otherwise, scan current directory for git repos
  await adoptMultipleRepos(ctx.configPath, configResult.data, cwd);
}

async function adoptSingleRepo(
  configPath: string,
  config: ReposConfig,
  repoPath: string
): Promise<void> {
  const name = basename(repoPath);

  if (findRepo(config, name)) {
    printError(`Error: "${name}" is already tracked`);
    process.exit(1);
  }

  const urlResult = await getRemoteUrl(repoPath);
  if (!urlResult.success) {
    printError('Error: No remote origin found');
    process.exit(1);
  }

  const branchResult = await getCurrentBranch(repoPath);
  if (!branchResult.success) {
    printError('Error: Could not get current branch');
    process.exit(1);
  }

  const newConfig = addRepoToConfig(config, {
    name,
    url: urlResult.data,
    branch: branchResult.data,
    path: repoPath,
  });

  const writeResult = await writeConfig(configPath, newConfig);
  if (!writeResult.success) {
    printError(`Error saving config: ${writeResult.error}`);
    process.exit(1);
  }

  print(`Adopted "${name}" on branch "${branchResult.data}"`);
}

async function adoptMultipleRepos(
  configPath: string,
  initialConfig: ReposConfig,
  directory: string
): Promise<void> {
  const repoNames = await findGitRepos(directory);

  if (repoNames.length === 0) {
    print('No git repos found in directory');
    return;
  }

  const newRepos = repoNames.filter((name) => !findRepo(initialConfig, name));

  if (newRepos.length === 0) {
    print('All repos are already tracked');
    return;
  }

  print(`Found ${newRepos.length} untracked repo(s)\n`);

  let config: ReposConfig = initialConfig;
  let adopted = 0;

  for (const name of newRepos) {
    const repoPath = join(directory, name);

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
      path: repoPath,
    });

    print(`  ✓ ${name} (${branchResult.data})`);
    adopted++;
  }

  if (adopted > 0) {
    const writeResult = await writeConfig(configPath, config);
    if (!writeResult.success) {
      printError(`\nError saving config: ${writeResult.error}`);
      process.exit(1);
    }
  }

  print(`\nAdopted ${adopted} repo(s)`);
}
