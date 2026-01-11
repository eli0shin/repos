import { join } from 'node:path';
import type { CommandContext } from '../cli.ts';
import {
  extractRepoName,
  loadConfig,
  writeConfig,
  addRepoToConfig,
  findRepo,
} from '../config.ts';
import { cloneRepo, cloneBare } from '../git.ts';
import { print, printError } from '../output.ts';

type AddOptions = {
  bare?: boolean;
};

export async function addCommand(
  ctx: CommandContext,
  url: string,
  options: AddOptions = {}
): Promise<void> {
  const nameResult = extractRepoName(url);
  if (!nameResult.success) {
    printError(`Error: ${nameResult.error}`);
    process.exit(1);
  }
  const name = nameResult.data;

  const config = await loadConfig(ctx.configPath);

  if (findRepo(config, name)) {
    printError(`Error: "${name}" is already tracked`);
    process.exit(1);
  }

  const targetDir = join(process.cwd(), name);

  if (options.bare) {
    print(`Cloning ${url} (bare) to ${targetDir}...`);

    const cloneResult = await cloneBare(url, targetDir);
    if (!cloneResult.success) {
      printError(`Error cloning: ${cloneResult.error}`);
      process.exit(1);
    }

    const newConfig = addRepoToConfig(config, {
      name,
      url,
      path: targetDir,
      bare: true,
    });

    const writeResult = await writeConfig(ctx.configPath, newConfig);
    if (!writeResult.success) {
      printError(`Error saving config: ${writeResult.error}`);
      process.exit(1);
    }

    print(`Added "${name}" as bare clone`);
  } else {
    print(`Cloning ${url} to ${targetDir}...`);

    const cloneResult = await cloneRepo(url, targetDir);
    if (!cloneResult.success) {
      printError(`Error cloning: ${cloneResult.error}`);
      process.exit(1);
    }

    const newConfig = addRepoToConfig(config, {
      name,
      url,
      path: targetDir,
    });

    const writeResult = await writeConfig(ctx.configPath, newConfig);
    if (!writeResult.success) {
      printError(`Error saving config: ${writeResult.error}`);
      process.exit(1);
    }

    print(`Added "${name}"`);
  }
}
