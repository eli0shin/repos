import { join } from 'node:path';
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
  cloneRepo,
  isGitRepo,
} from '../git/index.ts';
import { print, printError } from '../output.ts';

export async function syncCommand(ctx: CommandContext): Promise<void> {
  let config = await loadConfig(ctx.configPath);

  const cwd = process.cwd();
  let adopted = 0;
  let cloned = 0;

  print('Scanning for untracked repos...\n');

  const repoNames = await findGitRepos(cwd);
  const newRepos = repoNames.filter((name) => !findRepo(config, name));

  for (const name of newRepos) {
    const repoPath = join(cwd, name);

    const urlResult = await getRemoteUrl(repoPath);
    if (!urlResult.success) {
      print(`  ✗ ${name}: no remote origin`);
      continue;
    }

    config = addRepoToConfig(config, {
      name,
      url: urlResult.data,
      path: repoPath,
    });

    print(`  ✓ adopted ${name}`);
    adopted++;
  }

  print('\nCloning missing repos...\n');

  // Only clone repos whose paths are within the current directory
  const cwdPrefix = cwd + '/';
  const reposToClone = config.repos.filter(
    (repo) => repo.path.startsWith(cwdPrefix) || repo.path === cwd
  );

  for (const repo of reposToClone) {
    if (await isGitRepo(repo.path)) {
      continue;
    }

    print(`  Cloning ${repo.name}...`);
    const result = await cloneRepo(repo.url, repo.path);
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
