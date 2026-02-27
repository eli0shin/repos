import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  findRepoFromCwd,
  getParentBranch,
  removeStackEntry,
  saveStackUpdate,
} from '../config.ts';
import {
  getDefaultBranch,
  listWorktrees,
  findWorktreeByDirectory,
  fetchOrigin,
  rebaseOnto,
  rebaseOnRef,
  getBaseRef,
  deleteBaseRef,
  setBaseRef,
  runGitCommand,
} from '../git/index.ts';
import { print, printError } from '../output.ts';

export async function unstackCommand(ctx: CommandContext): Promise<void> {
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
    printError('Error: Not inside a worktree. Run from inside a worktree.');
    process.exit(1);
  }

  const currentBranch = currentWorktree.branch;

  // Check if this branch has a parent relationship
  const parentBranch = getParentBranch(repo, currentBranch);

  if (!parentBranch) {
    printError(
      `Error: Branch "${currentBranch}" is not stacked on any parent.`
    );
    process.exit(1);
  }

  // Get default branch for rebase target
  const defaultBranchResult = await getDefaultBranch(repo.path);
  if (!defaultBranchResult.success) {
    printError(`Error: ${defaultBranchResult.error}`);
    process.exit(1);
  }
  const defaultBranch = defaultBranchResult.data;
  const targetRef = `origin/${defaultBranch}`;

  print(
    `Unstacking "${currentBranch}" from "${parentBranch}" onto "${defaultBranch}"...`
  );

  // Fetch latest changes
  const fetchResult = await fetchOrigin(currentWorktree.path);
  if (!fetchResult.success) {
    printError(`Error fetching: ${fetchResult.error}`);
    process.exit(1);
  }

  // Use fork point for rebase to handle squash/rebase merges correctly
  const baseRefResult = await getBaseRef(repo.path, currentBranch);
  if (baseRefResult.success) {
    const rebaseResult = await rebaseOnto(
      currentWorktree.path,
      targetRef,
      baseRefResult.data
    );
    if (!rebaseResult.success) {
      printError(`Error: ${rebaseResult.error}`);
      process.exit(1);
    }
  } else {
    const rebaseResult = await rebaseOnRef(currentWorktree.path, targetRef);
    if (!rebaseResult.success) {
      printError(`Error: ${rebaseResult.error}`);
      process.exit(1);
    }
  }

  // Remove the stack relationship
  const updatedRepo = removeStackEntry(repo, currentBranch);
  await saveStackUpdate(ctx.configPath, config, updatedRepo);

  // Update base ref to track origin/main as the new parent for future rebases
  const targetCommit = await runGitCommand(['rev-parse', targetRef], repo.path);
  if (targetCommit.exitCode === 0) {
    await setBaseRef(repo.path, currentBranch, targetCommit.stdout.trim());
  } else {
    // If we can't resolve the target, clean up the stale base ref
    await deleteBaseRef(repo.path, currentBranch);
  }

  print(`Unstacked "${currentBranch}" - now independent on "${defaultBranch}"`);
}
