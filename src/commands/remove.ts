import { rm } from 'node:fs/promises';
import type { CommandContext } from '../cli.ts';
import {
  readConfig,
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
  const configResult = await readConfig(ctx.configPath);
  if (!configResult.success) {
    printError(`Error reading config: ${configResult.error}`);
    process.exit(1);
  }

  const repo = findRepo(configResult.data, name);
  if (!repo) {
    printError(`Error: "${name}" not found in config`);
    process.exit(1);
  }

  const newConfig = removeRepoFromConfig(configResult.data, name);
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
