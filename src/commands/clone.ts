import type { CommandContext } from '../cli.ts';
import { readConfig, findRepo } from '../config.ts';
import { cloneRepo, cloneBare, isGitRepo, isBareRepo } from '../git.ts';
import { print, printError } from '../output.ts';
import type { RepoEntry } from '../types.ts';

async function repoExists(repo: RepoEntry): Promise<boolean> {
  if (repo.bare) {
    return isBareRepo(repo.path);
  }
  return isGitRepo(repo.path);
}

async function cloneOne(
  repo: RepoEntry
): Promise<{ success: boolean; error?: string }> {
  if (repo.bare) {
    return cloneBare(repo.url, repo.path);
  }
  return cloneRepo(repo.url, repo.path);
}

export async function cloneCommand(
  ctx: CommandContext,
  name?: string
): Promise<void> {
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

  if (name) {
    const repo = findRepo(configResult.data, name);
    if (!repo) {
      printError(`Error: "${name}" not found in config`);
      process.exit(1);
    }

    if (await repoExists(repo)) {
      print(`"${repo.name}" already exists, skipping`);
      return;
    }

    const bareLabel = repo.bare ? ' (bare)' : '';
    print(`Cloning ${repo.name}${bareLabel}...`);
    const result = await cloneOne(repo);
    if (!result.success) {
      printError(`Error cloning ${repo.name}: ${result.error}`);
      process.exit(1);
    }
    print(`Cloned "${repo.name}"`);
    return;
  }

  let cloned = 0;
  let skipped = 0;

  for (const repo of repos) {
    if (await repoExists(repo)) {
      skipped++;
      continue;
    }

    const bareLabel = repo.bare ? ' (bare)' : '';
    print(`Cloning ${repo.name}${bareLabel}...`);
    const result = await cloneOne(repo);
    if (!result.success) {
      printError(`Error cloning ${repo.name}: ${result.error}`);
      continue;
    }
    cloned++;
  }

  print(`\nCloned ${cloned} repo(s), skipped ${skipped} existing`);
}
