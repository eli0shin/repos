import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  resolveRepo,
  removeStackEntry,
  removeStackEntriesByParent,
  getChildBranches,
  saveStackUpdate,
} from '../config.ts';
import {
  removeWorktree,
  hasUncommittedChanges,
  resolveWorktree,
} from '../git.ts';
import { print, printError } from '../output.ts';

type CleanOptions = {
  force: boolean;
};

export async function cleanCommand(
  ctx: CommandContext,
  branch?: string,
  repoName?: string,
  options: CleanOptions = { force: false }
): Promise<void> {
  const config = await loadConfig(ctx.configPath);
  const repo = await resolveRepo(config, repoName);
  const worktree = await resolveWorktree(repo.path, branch);

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

  print(`Removing worktree for "${worktree.branch}"...`);

  const result = await removeWorktree(repo.path, worktree.path);
  if (!result.success) {
    printError(`Error: ${result.error}`);
    process.exit(1);
  }

  // Clean up stack entries for this branch
  // 1. Remove entries where this branch is the child (its own parent relationship)
  // 2. Remove entries where this branch is the parent (children become independent)
  let updatedRepo = removeStackEntry(repo, worktree.branch);
  updatedRepo = removeStackEntriesByParent(updatedRepo, worktree.branch);
  if (updatedRepo !== repo) {
    await saveStackUpdate(ctx.configPath, config, updatedRepo);
  }

  print(`Removed worktree "${repo.name}-${worktree.branch}"`);
}
