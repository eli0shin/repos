#!/usr/bin/env bun
import { Command } from '@commander-js/extra-typings';
import { version } from '../package.json';
import {
  getConfigPath,
  readConfig,
  getUpdateBehavior,
  getUpdateCheckInterval,
} from './config.ts';
import { listCommand } from './commands/list.ts';
import { addCommand } from './commands/add.ts';
import { cloneCommand } from './commands/clone.ts';
import { removeCommand } from './commands/remove.ts';
import { latestCommand } from './commands/latest.ts';
import { adoptCommand } from './commands/adopt.ts';
import { syncCommand } from './commands/sync.ts';
import { updateCommand } from './commands/update.ts';
import { workCommand } from './commands/work.ts';
import { stackCommand } from './commands/stack.ts';
import { restackCommand } from './commands/restack.ts';
import { unstackCommand } from './commands/unstack.ts';
import { collapseCommand } from './commands/collapse.ts';
import { squashCommand } from './commands/squash.ts';
import { cleanCommand } from './commands/clean.ts';
import { cleanupCommand } from './commands/cleanup.ts';
import { rebaseCommand } from './commands/rebase.ts';
import { initCommand, initPrintCommand } from './commands/init.ts';
import { runUpdaterWorker } from './updater-worker.ts';
import { handleAutoUpdate, printUpdateMessage } from './auto-update.ts';
import type { UpdateBehavior } from './types.ts';

// Handle update worker mode early
if (process.argv[2] === '--update-worker') {
  await runUpdaterWorker();
  process.exit(0);
}

export type CommandContext = {
  configPath: string;
};

function getCommandContext(): CommandContext {
  return {
    configPath: getConfigPath(),
  };
}

type UpdateConfig = {
  behavior: UpdateBehavior;
  checkIntervalHours: number;
};

async function getUpdateConfigFromFile(): Promise<UpdateConfig> {
  const configPath = getConfigPath();
  const result = await readConfig(configPath);
  if (!result.success) {
    return { behavior: 'auto', checkIntervalHours: 24 };
  }
  return {
    behavior: getUpdateBehavior(result.data),
    checkIntervalHours: getUpdateCheckInterval(result.data),
  };
}

// Start auto-update check (non-blocking)
const updateConfig = await getUpdateConfigFromFile();
const autoUpdateResult = await handleAutoUpdate(
  version,
  updateConfig.behavior,
  updateConfig.checkIntervalHours
).catch(() => ({ message: undefined }));

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
  .command('stack')
  .description('Create a stacked worktree from current branch')
  .argument('<branch>', 'New branch name')
  .action(async (branch) => {
    await stackCommand(getCommandContext(), branch);
  });

program
  .command('restack')
  .description('Rebase current branch on its parent branch')
  .action(async () => {
    await restackCommand(getCommandContext());
  });

program
  .command('unstack')
  .description(
    'Rebase current branch on default branch and remove stack relationship'
  )
  .action(async () => {
    await unstackCommand(getCommandContext());
  });

program
  .command('collapse')
  .description('Collapse parent branch into current stacked branch')
  .action(async () => {
    await collapseCommand(getCommandContext());
  });

program
  .command('squash')
  .description('Squash commits since base branch into a single commit')
  .option('-m, --message <message>', 'Commit message for squashed commit')
  .option('-f, --first', 'Use first commit message as squash message')
  .action(async (options) => {
    await squashCommand(getCommandContext(), {
      message: options.message,
      first: options.first ?? false,
    });
  });

program
  .command('clean')
  .description('Remove a worktree')
  .argument('[branch]', 'Branch name (optional if inside a worktree)')
  .argument('[repo-name]', 'Repo name (optional if inside a tracked repo)')
  .option('--force', 'Force removal even if branch has stacked children')
  .action(async (branch, repoName, options) => {
    await cleanCommand(getCommandContext(), branch, repoName, {
      force: options.force ?? false,
    });
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
  .command('cleanup')
  .description('Remove worktrees for merged or deleted branches')
  .option('--dry-run', 'Show what would be removed without removing')
  .action(async (options) => {
    await cleanupCommand(getCommandContext(), {
      dryRun: options.dryRun ?? false,
    });
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

program.hook('postAction', () => {
  printUpdateMessage(autoUpdateResult.message);
});

program.parse();
