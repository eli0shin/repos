import type { CommandContext } from '../cli.ts';
import {
  readConfig,
  findRepo,
  findRepoFromCwd,
  removeStackEntry,
  removeStackEntriesByParent,
  getChildBranches,
  updateRepoInConfig,
  writeConfig,
} from '../config.ts';
import {
  removeWorktree,
  hasUncommittedChanges,
  listWorktrees,
} from '../git.ts';
import { print, printError } from '../output.ts';

type CleanOptions = {
  force: boolean;
};

export async function cleanCommand(
  ctx: CommandContext,
  branch: string,
  repoName?: string,
  options: CleanOptions = { force: false }
): Promise<void> {
  const configResult = await readConfig(ctx.configPath);
  if (!configResult.success) {
    printError(`Error reading config: ${configResult.error}`);
    process.exit(1);
  }

  let repo;
  if (repoName) {
    repo = findRepo(configResult.data, repoName);
    if (!repo) {
      printError(`Error: "${repoName}" not found in config`);
      process.exit(1);
    }
  } else {
    repo = await findRepoFromCwd(configResult.data, process.cwd());
    if (!repo) {
      printError('Error: Not inside a tracked repo. Specify repo name.');
      process.exit(1);
    }
  }

  // Find the worktree
  const worktreesResult = await listWorktrees(repo.path);
  if (!worktreesResult.success) {
    printError(`Error: ${worktreesResult.error}`);
    process.exit(1);
  }

  const worktree = worktreesResult.data.find((wt) => wt.branch === branch);
  if (!worktree) {
    printError(`Error: No worktree found for branch "${branch}"`);
    process.exit(1);
  }

  if (worktree.isMain) {
    printError('Error: Cannot remove the main worktree');
    process.exit(1);
  }

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
  const childBranches = getChildBranches(repo, branch);
  if (childBranches.length > 0 && !options.force) {
    printError(
      `Error: Branch "${branch}" has stacked children: ${childBranches.join(', ')}`
    );
    printError(
      'Use --force to remove anyway (children will become independent).'
    );
    process.exit(1);
  }

  print(`Removing worktree for "${branch}"...`);

  const result = await removeWorktree(repo.path, worktree.path);
  if (!result.success) {
    printError(`Error: ${result.error}`);
    process.exit(1);
  }

  // Clean up stack entries for this branch
  // 1. Remove entries where this branch is the child (its own parent relationship)
  // 2. Remove entries where this branch is the parent (children become independent)
  let updatedRepo = removeStackEntry(repo, branch);
  updatedRepo = removeStackEntriesByParent(updatedRepo, branch);
  if (updatedRepo !== repo) {
    const updatedConfig = updateRepoInConfig(configResult.data, updatedRepo);
    const writeResult = await writeConfig(ctx.configPath, updatedConfig);
    if (!writeResult.success) {
      printError(
        `Warning: Failed to clean up stack entry: ${writeResult.error}`
      );
    }
  }

  print(`Removed worktree "${repo.name}-${branch}"`);
}
