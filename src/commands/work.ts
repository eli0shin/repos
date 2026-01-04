import type { CommandContext } from '../cli.ts';
import {
  readConfig,
  findRepo,
  findRepoFromCwd,
  getWorktreePath,
} from '../config.ts';
import { createWorktree, listWorktrees, ensureRefspecConfig } from '../git.ts';
import { print, printError } from '../output.ts';

export async function workCommand(
  ctx: CommandContext,
  branch: string,
  repoName?: string
): Promise<void> {
  const configResult = await readConfig(ctx.configPath);
  if (!configResult.success) {
    printError(`Error reading config: ${configResult.error}`);
    process.exit(1);
  }

  let repo;
  if (repoName) {
    repo = findRepo(configResult.data, repoName);
    if (!repo) {
      printError(`Error: "${repoName}" not found in config`);
      process.exit(1);
    }
  } else {
    repo = await findRepoFromCwd(configResult.data, process.cwd());
    if (!repo) {
      printError('Error: Not inside a tracked repo. Specify repo name.');
      process.exit(1);
    }
  }

  // Check if worktree already exists - if so, output path and return
  const worktreesResult = await listWorktrees(repo.path);
  if (worktreesResult.success) {
    const existing = worktreesResult.data.find((wt) => wt.branch === branch);
    if (existing) {
      // Output path as last line for shell wrapper to cd into
      print(existing.path);
      return;
    }
  }

  // Ensure refspec is configured correctly (fixes bare repo issues)
  await ensureRefspecConfig(repo.path);

  const worktreePath = getWorktreePath(repo.path, branch);
  print(`Creating worktree for "${branch}"...`);

  const result = await createWorktree(repo.path, worktreePath, branch);
  if (!result.success) {
    printError(`Error: ${result.error}`);
    process.exit(1);
  }

  print(`Created worktree "${repo.name}-${branch.replace(/\//g, '-')}"`);
  // Output path as last line for shell wrapper to cd into
  print(worktreePath);
}
