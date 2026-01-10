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
} from '../git.ts';
import { print, printError } from '../output.ts';

export async function restackCommand(ctx: CommandContext): Promise<void> {
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
  const cwd = process.cwd();
  const currentWorktree = worktreesResult.data.find(
    (wt) => cwd === wt.path || cwd.startsWith(wt.path + '/')
  );

  if (!currentWorktree?.branch) {
    printError('Error: Not inside a worktree. Run from inside a worktree.');
    process.exit(1);
  }

  const currentBranch = currentWorktree.branch;

  // Get parent branch from config
  const parentBranch = getParentBranch(repo, currentBranch);

  if (!parentBranch) {
    printError(
      `Error: No parent branch recorded for "${currentBranch}". Use "repos rebase" instead.`
    );
    process.exit(1);
  }

  // Check if parent branch still exists (has an active worktree)
  const parentWorktree = worktreesResult.data.find(
    (wt) => wt.branch === parentBranch
  );
  const parentStillExists = parentWorktree !== undefined;

  // Determine target branch for rebase
  let targetRef: string;
  let updatedConfig = configResult.data;

  if (parentStillExists) {
    targetRef = parentBranch;
    print(`Rebasing "${currentBranch}" on parent branch "${parentBranch}"...`);
  } else {
    // Parent is gone - fallback to default branch
    const defaultBranchResult = await getDefaultBranch(repo.path);
    if (!defaultBranchResult.success) {
      printError(`Error: ${defaultBranchResult.error}`);
      process.exit(1);
    }
    const defaultBranch = defaultBranchResult.data;
    targetRef = `origin/${defaultBranch}`;

    // Remove the stale parent relationship
    const updatedRepo = removeStackEntry(repo, currentBranch);
    updatedConfig = updateRepoInConfig(configResult.data, updatedRepo);
    const writeResult = await writeConfig(ctx.configPath, updatedConfig);
    if (!writeResult.success) {
      printError(`Warning: Failed to update config: ${writeResult.error}`);
    }

    print(
      `Parent "${parentBranch}" is gone. Rebasing "${currentBranch}" on "${defaultBranch}"...`
    );
  }

  // Fetch first
  const fetchResult = await fetchOrigin(currentWorktree.path);
  if (!fetchResult.success) {
    printError(`Error fetching: ${fetchResult.error}`);
    process.exit(1);
  }

  // Rebase on target
  const rebaseResult = await rebaseOnRef(currentWorktree.path, targetRef);
  if (!rebaseResult.success) {
    printError(`Error: ${rebaseResult.error}`);
    process.exit(1);
  }

  print(`Rebased "${currentBranch}" on "${targetRef}"`);
}
