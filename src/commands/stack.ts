import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  findRepoFromCwd,
  getWorktreePath,
  addStackEntry,
  saveStackUpdate,
} from '../config.ts';
import {
  createWorktreeFromBranch,
  listWorktrees,
  ensureRefspecConfig,
  findWorktreeByDirectory,
  findWorktreeByBranch,
} from '../git.ts';
import { print, printError, printStatus } from '../output.ts';

export async function stackCommand(
  ctx: CommandContext,
  newBranch: string
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

  // Record parent-child relationship in config
  const updatedRepo = addStackEntry(repo, parentBranch, newBranch);
  await saveStackUpdate(ctx.configPath, config, updatedRepo);

  printStatus(
    `Created stacked worktree "${repo.name}-${newBranch.replace(/\//g, '-')}"`
  );
  // Output path to stdout for shell wrapper to cd into
  print(worktreePath);
}
