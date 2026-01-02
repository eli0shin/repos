#!/usr/bin/env bun
import { Command } from '@commander-js/extra-typings';
import { version } from '../package.json';
import { getConfigPath } from './config.ts';
import { listCommand } from './commands/list.ts';
import { addCommand } from './commands/add.ts';
import { cloneCommand } from './commands/clone.ts';
import { removeCommand } from './commands/remove.ts';
import { latestCommand } from './commands/latest.ts';
import { adoptCommand } from './commands/adopt.ts';
import { syncCommand } from './commands/sync.ts';
import { updateCommand } from './commands/update.ts';

export type CommandContext = {
  configPath: string;
};

function getCommandContext(): CommandContext {
  return {
    configPath: getConfigPath(),
  };
}

const program = new Command()
  .name('repos')
  .description('Git repository manager')
  .version(version, '-v, --version');

program
  .command('list')
  .description('List all tracked repositories')
  .action(async () => {
    await listCommand(getCommandContext());
  });

program
  .command('add')
  .description('Clone a repo and add it to tracking')
  .argument('<url>', 'Git repository URL')
  .action(async (url) => {
    await addCommand(getCommandContext(), url);
  });

program
  .command('clone')
  .description('Clone repos from config (all or specific)')
  .argument('[name]', 'Specific repo name to clone')
  .action(async (name) => {
    await cloneCommand(getCommandContext(), name);
  });

program
  .command('remove')
  .description('Remove a repo from tracking')
  .argument('<name>', 'Repo name to remove')
  .option('-d, --delete', 'Also delete the directory')
  .action(async (name, options) => {
    await removeCommand(getCommandContext(), name, options.delete ?? false);
  });

program
  .command('latest')
  .description('Pull all repos (parallel)')
  .action(async () => {
    await latestCommand(getCommandContext());
  });

program
  .command('adopt')
  .description('Add existing repos to config')
  .action(async () => {
    await adoptCommand(getCommandContext());
  });

program
  .command('sync')
  .description('Adopt existing + clone missing repos')
  .action(async () => {
    await syncCommand(getCommandContext());
  });

program
  .command('update')
  .description('Update repos CLI to latest version')
  .action(async () => {
    await updateCommand();
  });

program.parse();
