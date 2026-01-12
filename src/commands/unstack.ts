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
  fetchAndRebase,
} from '../git.ts';
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

  await fetchAndRebase(currentWorktree.path, targetRef);

  // Remove the stack relationship
  const updatedRepo = removeStackEntry(repo, currentBranch);
  await saveStackUpdate(ctx.configPath, config, updatedRepo);

  print(`Unstacked "${currentBranch}" - now independent on "${defaultBranch}"`);
}
