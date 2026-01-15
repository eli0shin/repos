import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  findRepoFromCwd,
  getParentBranch,
  getChildBranches,
  removeStackEntry,
  addStackEntry,
  saveStackUpdate,
} from '../config.ts';
import {
  getDefaultBranch,
  listWorktrees,
  removeWorktree,
  hasUncommittedChanges,
  findWorktreeByDirectory,
  findWorktreeByBranch,
  fetchAndRebase,
  deleteBaseRef,
  setBaseRef,
  getHeadCommit,
} from '../git/index.ts';
import { print, printError } from '../output.ts';

export async function collapseCommand(ctx: CommandContext): Promise<void> {
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

  // Check if parent has other children (siblings)
  const siblings = getChildBranches(repo, parentBranch);
  if (siblings.length > 1) {
    const otherSiblings = siblings.filter((s) => s !== currentBranch);
    printError(
      `Error: Parent "${parentBranch}" has other children: ${otherSiblings.join(', ')}`
    );
    printError('Collapse or unstack the other children first.');
    process.exit(1);
  }

  // Find the parent worktree
  const parentWorktree = findWorktreeByBranch(
    worktreesResult.data,
    parentBranch
  );

  if (!parentWorktree) {
    printError(`Error: Parent worktree for "${parentBranch}" not found.`);
    process.exit(1);
  }

  // Check for uncommitted changes in parent worktree
  const changesResult = await hasUncommittedChanges(parentWorktree.path);
  if (!changesResult.success) {
    printError(`Error: ${changesResult.error}`);
    process.exit(1);
  }

  if (changesResult.data) {
    printError(
      `Error: Parent worktree "${parentBranch}" has uncommitted changes.`
    );
    printError('Commit or stash them first.');
    process.exit(1);
  }

  // Get grandparent (parent's parent, or default branch if none)
  const grandparentBranch = getParentBranch(repo, parentBranch);

  // Determine target ref and rebase
  let targetRef: string;
  if (grandparentBranch) {
    print(
      `Collapsing "${parentBranch}" - rebasing "${currentBranch}" onto "${grandparentBranch}"...`
    );
    // Use local branch name directly since grandparent is a local worktree branch
    targetRef = grandparentBranch;
  } else {
    // No grandparent means parent was based on default branch
    const defaultBranchResult = await getDefaultBranch(repo.path);
    if (!defaultBranchResult.success) {
      printError(`Error: ${defaultBranchResult.error}`);
      process.exit(1);
    }
    const defaultBranch = defaultBranchResult.data;
    targetRef = `origin/${defaultBranch}`;

    print(
      `Collapsing "${parentBranch}" - rebasing "${currentBranch}" onto "${defaultBranch}"...`
    );
  }

  await fetchAndRebase(currentWorktree.path, targetRef);

  // Update config: remove parent->child, optionally add grandparent->child
  let updatedRepo = removeStackEntry(repo, currentBranch);
  if (grandparentBranch) {
    updatedRepo = addStackEntry(updatedRepo, grandparentBranch, currentBranch);
  }
  // Also remove the grandparent->parent entry since parent is going away
  updatedRepo = removeStackEntry(updatedRepo, parentBranch);

  await saveStackUpdate(ctx.configPath, config, updatedRepo);

  // Update base refs for fork point tracking
  // Delete the old base ref for current branch (it referenced parent)
  await deleteBaseRef(repo.path, currentBranch);

  // Delete base ref for parent branch (parent is being removed)
  await deleteBaseRef(repo.path, parentBranch);

  // If there's a grandparent, create a new base ref for current branch
  if (grandparentBranch) {
    const grandparentWorktree = findWorktreeByBranch(
      worktreesResult.data,
      grandparentBranch
    );
    if (grandparentWorktree) {
      const grandparentHeadResult = await getHeadCommit(
        grandparentWorktree.path
      );
      if (grandparentHeadResult.success) {
        await setBaseRef(repo.path, currentBranch, grandparentHeadResult.data);
      }
    }
  }

  // Remove parent worktree
  print(`Removing parent worktree "${parentBranch}"...`);
  const removeResult = await removeWorktree(repo.path, parentWorktree.path);
  if (!removeResult.success) {
    printError(
      `Warning: Failed to remove parent worktree: ${removeResult.error}`
    );
  }

  print(`Collapsed "${parentBranch}" into "${currentBranch}"`);
}
