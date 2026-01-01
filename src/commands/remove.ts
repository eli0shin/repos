import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import {
  readConfig,
  writeConfig,
  removeRepoFromConfig,
  findRepo,
} from '../config.ts';
import { isGitRepo } from '../git.ts';
import { print, printError } from '../output.ts';

type RemoveContext = {
  codeDir: string;
  configPath: string;
};

export async function removeCommand(
  ctx: RemoveContext,
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
    const repoPath = join(ctx.codeDir, name);
    if (await isGitRepo(repoPath)) {
      await rm(repoPath, { recursive: true, force: true });
      print(`Deleted directory: ${repoPath}`);
    } else {
      print(`Directory not found or not a git repo: ${repoPath}`);
    }
  }
}
