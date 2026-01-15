import { basename, join } from 'node:path';
import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  writeConfig,
  addRepoToConfig,
  findRepo,
} from '../config.ts';
import {
  findGitRepos,
  getRemoteUrl,
  isGitRepo,
  isBareRepo,
  listWorktrees,
} from '../git/index.ts';
import { print, printError } from '../output.ts';
import type { ReposConfig } from '../types.ts';

export async function adoptCommand(ctx: CommandContext): Promise<void> {
  const config = await loadConfig(ctx.configPath);

  const cwd = process.cwd();

  // If current directory is a bare repo, adopt it
  if (await isBareRepo(cwd)) {
    await adoptSingleRepo(ctx.configPath, config, cwd, true);
    return;
  }

  // If current directory is a regular git repo, adopt just that repo
  if (await isGitRepo(cwd)) {
    await adoptSingleRepo(ctx.configPath, config, cwd, false);
    return;
  }

  // Otherwise, scan current directory for git repos
  await adoptMultipleRepos(ctx.configPath, config, cwd);
}

async function adoptSingleRepo(
  configPath: string,
  config: ReposConfig,
  repoPath: string,
  bare: boolean
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

  const newConfig = addRepoToConfig(config, {
    name,
    url: urlResult.data,
    path: repoPath,
    ...(bare ? { bare: true } : {}),
  });

  const writeResult = await writeConfig(configPath, newConfig);
  if (!writeResult.success) {
    printError(`Error saving config: ${writeResult.error}`);
    process.exit(1);
  }

  print(`Adopted "${name}"`);
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

  // First pass: identify bare repos and collect their worktree paths (excluding the bare repo itself)
  const worktreePaths = new Set<string>();
  const bareRepos = new Set<string>();

  for (const name of repoNames) {
    const repoPath = join(directory, name);
    if (await isBareRepo(repoPath)) {
      bareRepos.add(name);
      const worktreesResult = await listWorktrees(repoPath);
      if (worktreesResult.success) {
        for (const wt of worktreesResult.data) {
          // Skip the main/bare entry itself - only collect non-main worktrees
          if (!wt.isMain) {
            worktreePaths.add(wt.path);
          }
        }
      }
    }
  }

  // Filter out repos that are worktrees of bare repos
  const filteredRepos = repoNames.filter((name) => {
    const repoPath = join(directory, name);
    return !worktreePaths.has(repoPath);
  });

  const newRepos = filteredRepos.filter(
    (name) => !findRepo(initialConfig, name)
  );

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

    const isBare = bareRepos.has(name);
    config = addRepoToConfig(config, {
      name,
      url: urlResult.data,
      path: repoPath,
      ...(isBare ? { bare: true } : {}),
    });

    print(`  ✓ ${name}`);
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
