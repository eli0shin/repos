import { join } from 'node:path';
import { readConfig, findRepo } from '../config.ts';
import { cloneRepo, isGitRepo } from '../git.ts';
import { print, printError } from '../output.ts';

type CloneContext = {
  codeDir: string;
  configPath: string;
};

export async function cloneCommand(
  ctx: CloneContext,
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

    const targetDir = join(ctx.codeDir, repo.name);
    if (await isGitRepo(targetDir)) {
      print(`"${repo.name}" already exists, skipping`);
      return;
    }

    print(`Cloning ${repo.name}...`);
    const result = await cloneRepo(repo.url, targetDir);
    if (!result.success) {
      printError(`Error cloning ${repo.name}: ${result.error}`);
      process.exit(1);
    }
    print(`Cloned "${repo.name}" on branch "${result.data.branch}"`);
    return;
  }

  let cloned = 0;
  let skipped = 0;

  for (const repo of repos) {
    const targetDir = join(ctx.codeDir, repo.name);

    if (await isGitRepo(targetDir)) {
      skipped++;
      continue;
    }

    print(`Cloning ${repo.name}...`);
    const result = await cloneRepo(repo.url, targetDir);
    if (!result.success) {
      printError(`Error cloning ${repo.name}: ${result.error}`);
      continue;
    }
    cloned++;
  }

  print(`\nCloned ${cloned} repo(s), skipped ${skipped} existing`);
}
