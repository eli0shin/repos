#!/usr/bin/env bun
import {
  Command,
  InvalidArgumentError,
  Option,
} from '@commander-js/extra-typings';
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
import { continueCommand } from './commands/continue.ts';
import { squashCommand } from './commands/squash.ts';
import { cleanCommand } from './commands/clean.ts';
import { mainCommand } from './commands/main.ts';
import { cleanupCommand } from './commands/cleanup.ts';
import { rebaseCommand } from './commands/rebase.ts';
import { initCommand, initPrintCommand } from './commands/init.ts';
import { runUpdaterWorker } from './updater-worker.ts';
import { handleAutoUpdate, printUpdateMessage } from './auto-update.ts';
import { print, printError } from './output.ts';
import { isInsideManagedEnvironment } from './workspace-manager/index.ts';
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

function resolveWorkspaceManagerOptions(
  tmux: boolean,
  focus: boolean
): { tmux: boolean; focus: boolean } {
  if (!focus && process.argv.slice(2).includes('--no-tmux')) {
    printError('Error: --no-focus cannot be combined with --no-tmux');
    process.exit(1);
  }

  return { tmux: !focus || tmux, focus };
}

function parseWorktreeIndex(value: string): number {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 1) {
    throw new InvalidArgumentError('index must be a positive integer');
  }
  return index;
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
  .argument('[branch]', 'Branch name for the worktree')
  .argument('[repo-name]', 'Repo name (optional if inside a tracked repo)')
  .addOption(
    new Option(
      '-t, --tmux',
      'Open the Managed Workspace for the worktree'
    ).default(isInsideManagedEnvironment())
  )
  .option(
    '--no-tmux',
    'Disable the Workspace Manager, even inside a managed environment'
  )
  .option('--no-focus', 'Create or reuse a Managed Workspace without focusing')
  .option(
    '-i, --index <index>',
    'Use a worktree index from repos list',
    parseWorktreeIndex
  )
  .action(async (branch, repoName, options) => {
    const tmuxOptions = resolveWorkspaceManagerOptions(
      options.tmux,
      options.focus
    );

    if (options.index !== undefined && branch && !repoName) {
      repoName = branch;
      branch = undefined;
    }

    await workCommand(getCommandContext(), branch, repoName, {
      ...tmuxOptions,
      index: options.index,
    });
  });

program
  .command('stack')
  .description('Create a stacked worktree from current branch')
  .argument('<branch>', 'New branch name')
  .addOption(
    new Option(
      '-t, --tmux',
      'Open the Managed Workspace for the worktree'
    ).default(isInsideManagedEnvironment())
  )
  .option(
    '--no-tmux',
    'Disable the Workspace Manager, even inside a managed environment'
  )
  .option('--no-focus', 'Create or reuse a Managed Workspace without focusing')
  .action(async (branch, options) => {
    const tmuxOptions = resolveWorkspaceManagerOptions(
      options.tmux,
      options.focus
    );
    await stackCommand(getCommandContext(), branch, tmuxOptions);
  });

program
  .command('restack')
  .description('Deprecated alias for rebase')
  .option('--only', 'Only restack current branch, skip children')
  .action(async (options) => {
    await restackCommand(getCommandContext(), { only: options.only ?? false });
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
  .command('continue')
  .description('Continue a paused rebase and update fork point tracking')
  .action(async () => {
    await continueCommand(getCommandContext());
  });

program
  .command('squash')
  .description('Squash commits since base branch into a single commit')
  .option('-m, --message <message>', 'Commit message for squashed commit')
  .option('-f, --first', 'Use first commit message as squash message')
  .option(
    '--dry-run',
    'Preview commits to be squashed without performing squash'
  )
  .action(async (options) => {
    await squashCommand(getCommandContext(), {
      message: options.message,
      first: options.first ?? false,
      dryRun: options.dryRun ?? false,
    });
  });

program
  .command('clean')
  .description('Remove a worktree')
  .argument('[branch]', 'Branch name (optional if inside a worktree)')
  .argument('[repo-name]', 'Repo name (optional if inside a tracked repo)')
  .option(
    '--force',
    'Force removal with uncommitted changes or stacked children'
  )
  .option('--dry-run', 'Show what would be removed without removing')
  .option(
    '-i, --index <index>',
    'Use a worktree index from repos list',
    parseWorktreeIndex
  )
  .addOption(
    new Option(
      '-t, --tmux',
      'Close the Managed Workspace and focus the main worktree'
    ).default(isInsideManagedEnvironment())
  )
  .option(
    '--no-tmux',
    'Disable the Workspace Manager, even inside a managed environment'
  )
  .option('--no-focus', 'Close the Managed Workspace without changing focus')
  .action(async (branch, repoName, options) => {
    const tmuxOptions = resolveWorkspaceManagerOptions(
      options.tmux,
      options.focus
    );

    if (options.index !== undefined && branch && !repoName) {
      repoName = branch;
      branch = undefined;
    }

    await cleanCommand(getCommandContext(), branch, repoName, {
      force: options.force ?? false,
      dryRun: options.dryRun ?? false,
      ...tmuxOptions,
      index: options.index,
    });
  });

program
  .command('main')
  .description('Output main worktree path (for shell wrapper to cd)')
  .argument('[repo-name]', 'Repo name (optional if inside a tracked repo)')
  .action(async (repoName) => {
    const result = await mainCommand(getCommandContext(), repoName);
    if (!result.success) {
      printError(`Error: ${result.error}`);
      process.exit(1);
    }
    print(result.data);
  });

program
  .command('rebase')
  .description('Update the default branch or rebase a branch and its children')
  .argument(
    '[branch]',
    'Branch name to update or rebase (optional if inside a worktree)'
  )
  .argument('[repo-name]', 'Repo name (optional if inside a tracked repo)')
  .option(
    '-i, --index <index>',
    'Use a worktree index from repos list',
    parseWorktreeIndex
  )
  .option('--only', 'Only rebase the selected branch, skip children')
  .action(async (branch, repoName, options) => {
    if (options.index !== undefined && branch && !repoName) {
      repoName = branch;
      branch = undefined;
    }

    await rebaseCommand(getCommandContext(), branch, repoName, {
      index: options.index,
      only: options.only ?? false,
    });
  });

program
  .command('cleanup')
  .description('Remove worktrees for merged or deleted branches')
  .option('--dry-run', 'Show what would be removed without removing')
  .addOption(
    new Option(
      '-t, --tmux',
      'Also close Managed Workspaces for removed worktrees'
    ).default(isInsideManagedEnvironment())
  )
  .option(
    '--no-tmux',
    'Disable the Workspace Manager, even inside a managed environment'
  )
  .action(async (options) => {
    await cleanupCommand(getCommandContext(), {
      dryRun: options.dryRun ?? false,
      tmux: options.tmux,
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
