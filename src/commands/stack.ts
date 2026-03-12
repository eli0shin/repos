import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  findRepoFromCwd,
  getWorktreePath,
  recordStack,
} from '../config.ts';
import {
  createWorktreeFromBranch,
  listWorktrees,
  ensureRefspecConfig,
  findWorktreeByDirectory,
  findWorktreeByBranch,
  getHeadCommit,
} from '../git/index.ts';
import { print, printError, printStatus } from '../output.ts';
import { openTmuxSession } from '../tmux.ts';

export async function stackCommand(
  ctx: CommandContext,
  newBranch: string,
  options?: { tmux?: boolean }
): Promise<void> {
  const config = await loadConfig(ctx.configPath);

  // Find repo from current working directory
  const repo = await findRepoFromCwd(config, process.cwd());
  if (!repo) {
    printError('Error: Not inside a tracked repo.');
    process.exit(1);
  }

  // List worktrees to find current branch
  const worktreesResult = await listWorktrees(repo.path);
  if (!worktreesResult.success) {
    printError(`Error: ${worktreesResult.error}`);
    process.exit(1);
  }

  // Find the worktree we're currently in
  const currentWorktree = findWorktreeByDirectory(
    worktreesResult.data,
    process.cwd()
  );

  if (!currentWorktree?.branch) {
    printError('Error: Must be inside a worktree with a branch to stack from.');
    process.exit(1);
  }

  const parentBranch = currentWorktree.branch;

  // Check if worktree for new branch already exists
  const existingWorktree = findWorktreeByBranch(
    worktreesResult.data,
    newBranch
  );
  if (existingWorktree) {
    printError(`Error: Worktree for branch "${newBranch}" already exists.`);
    process.exit(1);
  }

  // Ensure refspec is configured correctly (fixes bare repo issues)
  await ensureRefspecConfig(repo.path);

  const worktreePath = getWorktreePath(repo.path, newBranch);
  printStatus(
    `Creating stacked branch "${newBranch}" from "${parentBranch}"...`
  );

  const result = await createWorktreeFromBranch(
    repo.path,
    worktreePath,
    newBranch,
    parentBranch
  );

  if (!result.success) {
    printError(`Error: ${result.error}`);
    process.exit(1);
  }

  // Get the current HEAD of the parent branch (before cd'ing to new worktree)
  // This becomes the fork point for future restack operations
  const parentHeadResult = await getHeadCommit(currentWorktree.path);
  if (!parentHeadResult.success) {
    printError(`Error: ${parentHeadResult.error}`);
    process.exit(1);
  }

  // Record stack relationship: base ref + config entry
  await recordStack(
    repo.path,
    ctx.configPath,
    config,
    repo,
    parentBranch,
    newBranch,
    parentHeadResult.data
  );

  printStatus(
    `Created stacked worktree "${repo.name}-${newBranch.replace(/\//g, '-')}"`
  );

  if (options?.tmux) {
    await openTmuxSession(repo.name, newBranch, worktreePath);
  } else {
    // Output path to stdout for shell wrapper to cd into
    print(worktreePath);
  }
}
