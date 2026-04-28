import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  resolveRepoFromCwd,
  getWorktreePath,
  recordStack,
} from '../config.ts';
import {
  createWorktreeFromBranch,
  fetchOrigin,
  listWorktrees,
  ensureRefspecConfig,
  findWorktreeByDirectory,
  findWorktreeByBranch,
  getHeadCommit,
  getDefaultBranch,
  resolveRef,
} from '../git/index.ts';
import { print, printError, printStatus } from '../output.ts';
import { openTmuxSession } from '../tmux.ts';
import { loadRepoWorktreeConfig } from '../worktree-config.ts';
import { printSetupWarnings, runWorktreeSetup } from '../worktree-setup.ts';

export async function stackCommand(
  ctx: CommandContext,
  newBranch: string,
  options?: { tmux?: boolean }
): Promise<void> {
  const config = await loadConfig(ctx.configPath);

  const repo = await resolveRepoFromCwd(ctx.configPath, config);

  const worktreeConfigResult = await loadRepoWorktreeConfig(repo.path);
  if (!worktreeConfigResult.success) {
    printError(`Error reading worktree config: ${worktreeConfigResult.error}`);
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

  const defaultBranchResult = await getDefaultBranch(repo.path);
  if (!defaultBranchResult.success) {
    printError(`Error: ${defaultBranchResult.error}`);
    process.exit(1);
  }

  const defaultBranch = defaultBranchResult.data;
  const isStackingFromDefaultBranch = parentBranch === defaultBranch;
  let sourceRef = parentBranch;
  let parentCommit: string;

  if (isStackingFromDefaultBranch) {
    const fetchResult = await fetchOrigin(repo.path);
    if (!fetchResult.success) {
      printError(`Error: Failed to fetch origin: ${fetchResult.error}`);
      process.exit(1);
    }

    sourceRef = `origin/${defaultBranch}`;
    const parentCommitResult = await resolveRef(repo.path, sourceRef);
    if (!parentCommitResult.success) {
      printError(`Error: ${parentCommitResult.error}`);
      process.exit(1);
    }
    parentCommit = parentCommitResult.data;
  } else {
    // Get the current HEAD of the parent branch before creating the child.
    // This becomes the fork point for future restack operations.
    const parentHeadResult = await getHeadCommit(currentWorktree.path);
    if (!parentHeadResult.success) {
      printError(`Error: ${parentHeadResult.error}`);
      process.exit(1);
    }
    parentCommit = parentHeadResult.data;
  }

  const worktreePath = getWorktreePath(repo.path, newBranch);
  printStatus(
    `Creating stacked branch "${newBranch}" from "${parentBranch}"...`
  );

  const result = await createWorktreeFromBranch(
    repo.path,
    worktreePath,
    newBranch,
    sourceRef
  );

  if (!result.success) {
    printError(`Error: ${result.error}`);
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
    parentCommit
  );

  const setupResult = await runWorktreeSetup(
    worktreeConfigResult.data.mainWorktreePath,
    worktreePath,
    worktreeConfigResult.data.config.setup
  );
  if (setupResult.warnings.length > 0) {
    printSetupWarnings(setupResult.warnings);
  }

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
