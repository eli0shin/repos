import { join } from 'node:path';
import {
  extractRepoName,
  readConfig,
  writeConfig,
  addRepoToConfig,
  findRepo,
} from '../config.ts';
import { cloneRepo } from '../git.ts';
import { print, printError } from '../output.ts';

type AddContext = {
  codeDir: string;
  configPath: string;
};

export async function addCommand(ctx: AddContext, url: string): Promise<void> {
  const nameResult = extractRepoName(url);
  if (!nameResult.success) {
    printError(`Error: ${nameResult.error}`);
    process.exit(1);
  }
  const name = nameResult.data;

  const configResult = await readConfig(ctx.configPath);
  if (!configResult.success) {
    printError(`Error reading config: ${configResult.error}`);
    process.exit(1);
  }

  if (findRepo(configResult.data, name)) {
    printError(`Error: "${name}" is already tracked`);
    process.exit(1);
  }

  const targetDir = join(ctx.codeDir, name);
  print(`Cloning ${url} to ${targetDir}...`);

  const cloneResult = await cloneRepo(url, targetDir);
  if (!cloneResult.success) {
    printError(`Error cloning: ${cloneResult.error}`);
    process.exit(1);
  }

  const newConfig = addRepoToConfig(configResult.data, {
    name,
    url,
    branch: cloneResult.data.branch,
  });

  const writeResult = await writeConfig(ctx.configPath, newConfig);
  if (!writeResult.success) {
    printError(`Error saving config: ${writeResult.error}`);
    process.exit(1);
  }

  print(`Added "${name}" on branch "${cloneResult.data.branch}"`);
}
