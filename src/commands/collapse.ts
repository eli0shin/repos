import type { CommandContext } from '../cli.ts';
import {
  readConfig,
  findRepoFromCwd,
  getParentBranch,
  getChildBranches,
  removeStackEntry,
  addStackEntry,
  updateRepoInConfig,
  writeConfig,
} from '../config.ts';
import {
  fetchOrigin,
  rebaseOnRef,
  getDefaultBranch,
  listWorktrees,
  removeWorktree,
  hasUncommittedChanges,
} from '../git.ts';
import { print, printError } from '../output.ts';

export async function collapseCommand(ctx: CommandContext): Promise<void> {
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
  const parentWorktree = worktreesResult.data.find(
    (wt) => wt.branch === parentBranch
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

  // Fetch first
  const fetchResult = await fetchOrigin(currentWorktree.path);
  if (!fetchResult.success) {
    printError(`Error fetching: ${fetchResult.error}`);
    process.exit(1);
  }

  // Rebase onto grandparent or default branch
  if (grandparentBranch) {
    print(
      `Collapsing "${parentBranch}" - rebasing "${currentBranch}" onto "${grandparentBranch}"...`
    );
    // Use local branch name directly since grandparent is a local worktree branch
    const rebaseResult = await rebaseOnRef(
      currentWorktree.path,
      grandparentBranch
    );
    if (!rebaseResult.success) {
      printError(`Error: ${rebaseResult.error}`);
      process.exit(1);
    }
  } else {
    // No grandparent means parent was based on default branch
    const defaultBranchResult = await getDefaultBranch(repo.path);
    if (!defaultBranchResult.success) {
      printError(`Error: ${defaultBranchResult.error}`);
      process.exit(1);
    }
    const defaultBranch = defaultBranchResult.data;
    const targetRef = `origin/${defaultBranch}`;

    print(
      `Collapsing "${parentBranch}" - rebasing "${currentBranch}" onto "${defaultBranch}"...`
    );
    const rebaseResult = await rebaseOnRef(currentWorktree.path, targetRef);
    if (!rebaseResult.success) {
      printError(`Error: ${rebaseResult.error}`);
      process.exit(1);
    }
  }

  // Update config: remove parent->child, optionally add grandparent->child
  let updatedRepo = removeStackEntry(repo, currentBranch);
  if (grandparentBranch) {
    updatedRepo = addStackEntry(updatedRepo, grandparentBranch, currentBranch);
  }
  // Also remove the grandparent->parent entry since parent is going away
  updatedRepo = removeStackEntry(updatedRepo, parentBranch);

  const updatedConfig = updateRepoInConfig(configResult.data, updatedRepo);
  const writeResult = await writeConfig(ctx.configPath, updatedConfig);
  if (!writeResult.success) {
    printError(`Warning: Failed to update config: ${writeResult.error}`);
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
