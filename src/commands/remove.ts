import { rm } from 'node:fs/promises';
import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  saveConfig,
  removeRepoFromConfig,
  findRepo,
} from '../config.ts';
import {
  isGitRepoOrBare,
  listWorktrees,
  removeWorktree,
} from '../git/index.ts';
import { print, printError } from '../output.ts';

export async function removeCommand(
  ctx: CommandContext,
  name: string,
  deleteDir: boolean
): Promise<void> {
  const config = await loadConfig(ctx.configPath);

  const repo = findRepo(config, name);
  if (!repo) {
    printError(`Error: "${name}" not found in config`);
    process.exit(1);
  }

  const newConfig = removeRepoFromConfig(config, name);
  await saveConfig(ctx.configPath, newConfig);

  print(`Removed "${name}" from config`);

  if (deleteDir) {
    if (await isGitRepoOrBare(repo.path)) {
      // Clean up worktrees before deleting the repo directory
      const worktreesResult = await listWorktrees(repo.path);
      if (worktreesResult.success) {
        for (const wt of worktreesResult.data) {
          if (!wt.isMain) {
            const result = await removeWorktree(repo.path, wt.path);
            if (!result.success) {
              printError(
                `Warning: failed to remove worktree ${wt.path}: ${result.error}`
              );
            }
          }
        }
      }

      await rm(repo.path, { recursive: true, force: true });
      print(`Deleted directory: ${repo.path}`);
    } else {
      print(`Directory not found or not a git repo: ${repo.path}`);
    }
  }
}
