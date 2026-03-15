import { join } from 'node:path';
import type { CommandContext } from '../cli.ts';
import {
  extractRepoName,
  readConfigOrExit,
  writeConfigOrExit,
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

  const config = await readConfigOrExit(ctx.configPath);

  if (findRepo(config, name)) {
    printError(`Error: "${name}" is already tracked`);
    process.exit(1);
  }

  const targetDir = join(process.cwd(), name);
  const bare = options.bare ?? false;
  const bareLabel = bare ? ' (bare)' : '';

  print(`Cloning ${url}${bareLabel} to ${targetDir}...`);

  const cloneResult = bare
    ? await cloneBare(url, targetDir)
    : await cloneRepo(url, targetDir);

  if (!cloneResult.success) {
    printError(`Error cloning: ${cloneResult.error}`);
    process.exit(1);
  }

  const newConfig = addRepoToConfig(config, {
    name,
    url,
    path: targetDir,
    ...(bare ? { bare: true } : {}),
  });

  await writeConfigOrExit(ctx.configPath, newConfig);

  print(`Added "${name}"${bareLabel ? ` as bare clone` : ''}`);
}
