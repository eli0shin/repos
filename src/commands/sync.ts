import type { CommandContext } from '../cli.ts';
import { loadConfig } from '../config.ts';
import { adoptMultipleRepos } from './adopt.ts';
import { repoExists, cloneOne } from './clone.ts';
import { print, printError } from '../output.ts';

export async function syncCommand(ctx: CommandContext): Promise<void> {
  const initialConfig = await loadConfig(ctx.configPath);
  const cwd = process.cwd();

  // Phase 1: Adopt untracked repos (uses adopt's full implementation with bare repo + worktree filtering)
  print('Scanning for untracked repos...\n');
  const { config } = await adoptMultipleRepos(
    ctx.configPath,
    initialConfig,
    cwd
  );

  // Phase 2: Clone missing repos (uses clone's helpers with bare repo support)
  print('\nCloning missing repos...\n');

  const cwdPrefix = cwd + '/';
  const reposToClone = config.repos.filter(
    (repo) => repo.path.startsWith(cwdPrefix) || repo.path === cwd
  );

  let cloned = 0;

  for (const repo of reposToClone) {
    if (await repoExists(repo)) {
      continue;
    }

    const bareLabel = repo.bare ? ' (bare)' : '';
    print(`  Cloning ${repo.name}${bareLabel}...`);
    const result = await cloneOne(repo);
    if (!result.success) {
      printError(`  ✗ ${repo.name}: ${result.error}`);
      continue;
    }
    print(`  ✓ cloned ${repo.name}`);
    cloned++;
  }

  print(`\nSync complete: cloned ${cloned}`);
}
