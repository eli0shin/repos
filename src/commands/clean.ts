import type { CommandContext } from '../cli.ts';
import { loadConfig, resolveRepo } from '../config.ts';
import {
  removeWorktree,
  hasUncommittedChanges,
  resolveWorktree,
  listWorktrees,
  findWorktreeByBranch,
  getDefaultBranch,
} from '../git/index.ts';
import { print, printError, printStatus } from '../output.ts';
import {
  getSessionName,
  isInsideTmux,
  openTmuxSession,
  tmuxHasSession,
  tmuxKillSession,
} from '../tmux.ts';
import { resolveWorktreeIndex } from '../worktree-index.ts';
import {
  getChildBranches,
  getParentBranch,
  removeBranchStack,
} from '../branch-stack/index.ts';

function resolveCleanOutputPath(
  repoPath: string,
  parentBranch: string | undefined,
  worktrees: { path: string; branch: string; isMain: boolean }[]
): string {
  const mainWorktreePath = worktrees.find(
    (candidate) => candidate.isMain
  )?.path;
  if (!parentBranch) {
    return mainWorktreePath ?? repoPath;
  }

  const parentWorktreePath = findWorktreeByBranch(
    worktrees,
    parentBranch
  )?.path;
  return parentWorktreePath ?? mainWorktreePath ?? repoPath;
}

type CleanOptions = {
  force: boolean;
  dryRun: boolean;
  tmux: boolean;
  index?: number;
};

export async function cleanCommand(
  ctx: CommandContext,
  branch?: string,
  repoName?: string,
  options: CleanOptions = { force: false, dryRun: false, tmux: false }
): Promise<void> {
  const config = await loadConfig(ctx.configPath);
  const repo = await resolveRepo(config, repoName);

  if (options.index !== undefined && branch) {
    printError('Error: cannot specify both branch and --index');
    process.exit(1);
  }

  if (options.index !== undefined) {
    const indexedResult = await resolveWorktreeIndex(repo, options.index);
    if (!indexedResult.success) {
      printError(indexedResult.error);
      process.exit(1);
    }
    branch = indexedResult.data.branch;
  }

  const worktree = await resolveWorktree(repo.path, branch);

  if (worktree.isMain) {
    printError('Error: Cannot remove the main worktree');
    process.exit(1);
  }

  const worktreesResult = await listWorktrees(repo.path);
  if (!worktreesResult.success) {
    printError(`Error: ${worktreesResult.error}`);
    process.exit(1);
  }

  const outputPath = resolveCleanOutputPath(
    repo.path,
    getParentBranch(repo, worktree.branch),
    worktreesResult.data
  );

  // Check for uncommitted changes
  const changesResult = await hasUncommittedChanges(worktree.path);
  if (!changesResult.success) {
    printError(`Error: ${changesResult.error}`);
    process.exit(1);
  }

  if (changesResult.data) {
    printError(
      'Error: Worktree has uncommitted changes. Commit or stash them first.'
    );
    process.exit(1);
  }

  // Check if this branch has stacked children
  const childBranches = getChildBranches(repo, worktree.branch);
  if (childBranches.length > 0 && !options.force) {
    printError(
      `Error: Branch "${worktree.branch}" has stacked children: ${childBranches.join(', ')}`
    );
    printError(
      'Use --force to remove anyway (children will become independent).'
    );
    process.exit(1);
  }

  const prefix = options.dryRun ? 'Would remove' : 'Removed';
  const worktreeName = `${repo.name}-${worktree.branch}`;

  if (!options.dryRun) {
    printStatus(`Removing worktree for "${worktree.branch}"...`);

    const result = await removeWorktree(repo.path, worktree.path);
    if (!result.success) {
      printError(`Error: ${result.error}`);
      process.exit(1);
    }

    const stackResult = await removeBranchStack(
      ctx.configPath,
      config,
      repo,
      worktree.branch
    );
    for (const warning of stackResult.warnings) {
      printError(warning);
    }
  }

  printStatus(`${prefix} worktree "${worktreeName}"`);

  if (options.dryRun) {
    return;
  }

  if (options.tmux) {
    const defaultBranchResult = await getDefaultBranch(repo.path);
    if (!defaultBranchResult.success) {
      printError(`Error: ${defaultBranchResult.error}`);
      process.exit(1);
    }
    const defaultBranch = defaultBranchResult.data;
    const mainWorktree = worktreesResult.data.find((wt) => wt.isMain);
    const mainPath =
      findWorktreeByBranch(worktreesResult.data, defaultBranch)?.path ??
      mainWorktree?.path ??
      repo.path;

    // The cwd may have been the worktree we just removed; move somewhere
    // valid so subsequent subprocess spawns (tmux) can resolve their cwd.
    process.chdir(mainPath);

    const sessionName = getSessionName(repo.name, worktree.branch);

    const killWorktreeSession = async (): Promise<void> => {
      const hasSession = await tmuxHasSession(sessionName);
      if (!hasSession.success || !hasSession.data) return;
      const killResult = await tmuxKillSession(sessionName);
      if (!killResult.success) {
        printError(`Warning: ${killResult.error}`);
      }
    };

    // Inside tmux we must move the client to the main session BEFORE
    // killing the worktree session — killing the session we're attached
    // to would disconnect the client (and in the single-session case the
    // whole tmux server exits).
    //
    // Outside tmux we kill first because openTmuxSession attaches, which
    // blocks until the user detaches.
    if (isInsideTmux()) {
      await openTmuxSession(repo.name, defaultBranch, mainPath);
      await killWorktreeSession();
    } else {
      await killWorktreeSession();
      await openTmuxSession(repo.name, defaultBranch, mainPath);
    }
    return;
  }

  print(outputPath);
}
