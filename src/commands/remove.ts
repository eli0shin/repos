import { rm } from 'node:fs/promises';
import type { CommandContext } from '../cli.ts';
import {
  readConfigOrExit,
  writeConfigOrExit,
  removeRepoFromConfig,
  findRepo,
} from '../config.ts';
import { isGitRepoOrBare, listWorktrees, removeWorktree } from '../git.ts';
import { print, printError } from '../output.ts';

export async function removeCommand(
  ctx: CommandContext,
  name: string,
  deleteDir: boolean
): Promise<void> {
  const config = await readConfigOrExit(ctx.configPath);

  const repo = findRepo(config, name);
  if (!repo) {
    printError(`Error: "${name}" not found in config`);
    process.exit(1);
  }

  const newConfig = removeRepoFromConfig(config, name);
  await writeConfigOrExit(ctx.configPath, newConfig);

  print(`Removed "${name}" from config`);

  if (deleteDir) {
    if (await isGitRepoOrBare(repo.path)) {
      // Clean up worktrees before deleting
      const worktreesResult = await listWorktrees(repo.path);
      if (worktreesResult.success) {
        for (const wt of worktreesResult.data) {
          if (!wt.isMain) {
            await removeWorktree(repo.path, wt.path);
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
