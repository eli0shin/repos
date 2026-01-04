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
import { workCommand } from './commands/work.ts';
import { cleanCommand } from './commands/clean.ts';
import { rebaseCommand } from './commands/rebase.ts';
import { initCommand, initPrintCommand } from './commands/init.ts';

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
  .option('--bare', 'Clone as bare repository for worktree use')
  .action(async (url, options) => {
    await addCommand(getCommandContext(), url, { bare: options.bare });
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

program
  .command('work')
  .description('Create a worktree for a branch')
  .argument('<branch>', 'Branch name for the worktree')
  .argument('[repo-name]', 'Repo name (optional if inside a tracked repo)')
  .action(async (branch, repoName) => {
    await workCommand(getCommandContext(), branch, repoName);
  });

program
  .command('clean')
  .description('Remove a worktree')
  .argument('<branch>', 'Branch name of the worktree to remove')
  .argument('[repo-name]', 'Repo name (optional if inside a tracked repo)')
  .action(async (branch, repoName) => {
    await cleanCommand(getCommandContext(), branch, repoName);
  });

program
  .command('rebase')
  .description('Rebase a worktree branch on the default branch')
  .argument('[branch]', 'Branch name to rebase (optional if inside a worktree)')
  .argument('[repo-name]', 'Repo name (optional if inside a tracked repo)')
  .action(async (branch, repoName) => {
    await rebaseCommand(getCommandContext(), branch, repoName);
  });

program
  .command('init')
  .description('Configure shell for work command')
  .option('--print', 'Output shell function instead of configuring')
  .option('--force', 'Update existing configuration')
  .action(async (options) => {
    if (options.print) {
      initPrintCommand();
    } else {
      await initCommand(options.force ?? false);
    }
  });

program.parse();
