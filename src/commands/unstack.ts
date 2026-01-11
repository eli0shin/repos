import type { CommandContext } from '../cli.ts';
import {
  readConfig,
  findRepoFromCwd,
  getParentBranch,
  removeStackEntry,
  updateRepoInConfig,
  writeConfig,
} from '../config.ts';
import {
  fetchOrigin,
  rebaseOnRef,
  getDefaultBranch,
  listWorktrees,
  findWorktreeByDirectory,
} from '../git.ts';
import { print, printError } from '../output.ts';

export async function unstackCommand(ctx: CommandContext): Promise<void> {
  const configResult = await readConfig(ctx.configPath);
  if (!configResult.success) {
    printError(`Error reading config: ${configResult.error}`);
    process.exit(1);
  }

  // Find repo from current working directory
  const repo = await findRepoFromCwd(configResult.data, process.cwd());
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

  // Fetch first
  const fetchResult = await fetchOrigin(currentWorktree.path);
  if (!fetchResult.success) {
    printError(`Error fetching: ${fetchResult.error}`);
    process.exit(1);
  }

  // Rebase on default branch
  const rebaseResult = await rebaseOnRef(currentWorktree.path, targetRef);
  if (!rebaseResult.success) {
    printError(`Error: ${rebaseResult.error}`);
    process.exit(1);
  }

  // Remove the stack relationship
  const updatedRepo = removeStackEntry(repo, currentBranch);
  const updatedConfig = updateRepoInConfig(configResult.data, updatedRepo);
  const writeResult = await writeConfig(ctx.configPath, updatedConfig);
  if (!writeResult.success) {
    printError(`Warning: Failed to update config: ${writeResult.error}`);
  }

  print(`Unstacked "${currentBranch}" - now independent on "${defaultBranch}"`);
}
