import { rm } from 'node:fs/promises';
import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  writeConfig,
  removeRepoFromConfig,
  findRepo,
} from '../config.ts';
import { isGitRepo } from '../git.ts';
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
  const writeResult = await writeConfig(ctx.configPath, newConfig);
  if (!writeResult.success) {
    printError(`Error saving config: ${writeResult.error}`);
    process.exit(1);
  }

  print(`Removed "${name}" from config`);

  if (deleteDir) {
    if (await isGitRepo(repo.path)) {
      await rm(repo.path, { recursive: true, force: true });
      print(`Deleted directory: ${repo.path}`);
    } else {
      print(`Directory not found or not a git repo: ${repo.path}`);
    }
  }
}
