#!/usr/bin/env bun
import { homedir } from 'node:os';
import { join } from 'node:path';
import { listCommand } from './commands/list.ts';
import { addCommand } from './commands/add.ts';
import { cloneCommand } from './commands/clone.ts';
import { removeCommand } from './commands/remove.ts';
import { latestCommand } from './commands/latest.ts';
import { adoptCommand } from './commands/adopt.ts';
import { syncCommand } from './commands/sync.ts';
import { print, printError } from './output.ts';

type CommandOptions = {
  codeDir: string;
  configPath: string;
};

function getCommandOptions(): CommandOptions {
  const codeDir = join(homedir(), 'code');
  return {
    codeDir,
    configPath: join(codeDir, 'repos.json'),
  };
}

function printUsage(): void {
  print(`repos - Git repository manager

Usage: repos <command> [options]

Commands:
  list              List all tracked repositories
  add <url>         Clone a repo and add it to tracking
  clone [name]      Clone repos from config (all or specific)
  remove <name>     Remove a repo from tracking
    --delete        Also delete the directory
  latest            Pull all repos (parallel)
  adopt             Add existing repos to config
  sync              Adopt existing + clone missing repos

Examples:
  repos add git@github.com:user/repo.git
  repos clone
  repos clone my-repo
  repos remove my-repo --delete
  repos sync`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  const options = getCommandOptions();

  switch (command) {
    case 'list':
      await listCommand(options);
      break;

    case 'add': {
      const url = args[1];
      if (!url) {
        printError('Error: URL required');
        printError('Usage: repos add <url>');
        process.exit(1);
      }
      await addCommand(options, url);
      break;
    }

    case 'clone': {
      const name = args[1];
      await cloneCommand(options, name);
      break;
    }

    case 'remove': {
      const name = args[1];
      if (!name) {
        printError('Error: repo name required');
        printError('Usage: repos remove <name> [--delete]');
        process.exit(1);
      }
      const deleteDir = args.includes('--delete');
      await removeCommand(options, name, deleteDir);
      break;
    }

    case 'latest':
      await latestCommand(options);
      break;

    case 'adopt':
      await adoptCommand(options);
      break;

    case 'sync':
      await syncCommand(options);
      break;

    default:
      printError(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'Unknown error';
  printError(`Fatal error: ${message}`);
  process.exit(1);
});
