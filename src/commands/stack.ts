import type { CommandContext } from '../cli.ts';
import {
  readConfig,
  findRepoFromCwd,
  getWorktreePath,
  writeConfig,
  addStackEntry,
  updateRepoInConfig,
} from '../config.ts';
import {
  createWorktreeFromBranch,
  listWorktrees,
  ensureRefspecConfig,
} from '../git.ts';
import { print, printError } from '../output.ts';

export async function stackCommand(
  ctx: CommandContext,
  newBranch: string
): Promise<void> {
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
    printError('Error: Must be inside a worktree with a branch to stack from.');
    process.exit(1);
  }

  const parentBranch = currentWorktree.branch;

  // Check if worktree for new branch already exists
  const existingWorktree = worktreesResult.data.find(
    (wt) => wt.branch === newBranch
  );
  if (existingWorktree) {
    printError(`Error: Worktree for branch "${newBranch}" already exists.`);
    process.exit(1);
  }

  // Ensure refspec is configured correctly (fixes bare repo issues)
  await ensureRefspecConfig(repo.path);

  const worktreePath = getWorktreePath(repo.path, newBranch);
  printError(
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
  const updatedConfig = updateRepoInConfig(configResult.data, updatedRepo);
  const writeResult = await writeConfig(ctx.configPath, updatedConfig);
  if (!writeResult.success) {
    printError(
      `Warning: Failed to save stack relationship: ${writeResult.error}`
    );
  }

  printError(
    `Created stacked worktree "${repo.name}-${newBranch.replace(/\//g, '-')}"`
  );
  // Output path to stdout for shell wrapper to cd into
  print(worktreePath);
}
