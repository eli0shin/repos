import type { CommandContext } from '../cli.ts';
import { readConfig, findRepoFromCwd, getParentBranch } from '../config.ts';
import {
  hasUncommittedChanges,
  getDefaultBranch,
  listWorktrees,
  getCommitCount,
  getFirstCommitMessage,
  softResetTo,
  commitWithMessage,
  commitWithEditor,
  getMergeBase,
  fetchOrigin,
  getCurrentBranch,
  getCommitList,
  getBranchesContaining,
  getCommitInfo,
} from '../git/index.ts';
import { print, printError, printStatus } from '../output.ts';
import type { OperationResult } from '../types.ts';

type SquashOptions = {
  message?: string;
  first?: boolean;
  dryRun?: boolean;
};

async function printDryRunOutput(
  workDir: string,
  mergeBase: string,
  baseRef: string,
  commitCount: number
): Promise<OperationResult<void>> {
  // Get list of commits to be squashed
  const commitsResult = await getCommitList(workDir, mergeBase);
  if (!commitsResult.success) {
    return { success: false, error: commitsResult.error };
  }

  // Get merge-base commit info
  const baseCommitResult = await getCommitInfo(workDir, mergeBase);
  if (!baseCommitResult.success) {
    return { success: false, error: baseCommitResult.error };
  }

  // Get branches containing merge-base
  const branchesResult = await getBranchesContaining(workDir, mergeBase);
  const branches = branchesResult.success ? branchesResult.data : [];

  // Output header
  print(`\nDry run: ${commitCount} commit(s) would be squashed\n`);

  // Output commits to be squashed
  print('Commits to be squashed:');
  for (const commit of commitsResult.data) {
    print(
      `  ${commit.shortHash} ${commit.subject} (${commit.author}, ${commit.date})`
    );
  }

  // Output merge-base info
  print(`\nMerge base (boundary commit):`);
  print(
    `  ${baseCommitResult.data.shortHash} ${baseCommitResult.data.subject}`
  );
  print(`  Base ref: ${baseRef}`);

  // Output branches containing merge-base
  if (branches.length > 0) {
    print(`\nBranches containing merge-base:`);
    for (const branch of branches) {
      print(`  ${branch}`);
    }
  } else {
    print(`\nNo branches contain the merge-base commit.`);
  }

  print('');
  return { success: true, data: undefined };
}

export async function squashCommand(
  ctx: CommandContext,
  options: SquashOptions
): Promise<void> {
  // Validate options
  if (options.message && options.first) {
    printError('Error: Cannot use both -m and -f flags together.');
    process.exit(1);
  }

  if (options.message?.trim() === '') {
    printError('Error: Commit message cannot be empty.');
    process.exit(1);
  }

  // Step 1: Read config and find repo
  const configResult = await readConfig(ctx.configPath);
  if (!configResult.success) {
    printError(`Error reading config: ${configResult.error}`);
    process.exit(1);
  }

  const repo = await findRepoFromCwd(configResult.data, process.cwd());
  if (!repo) {
    printError('Error: Not inside a tracked repo.');
    process.exit(1);
  }

  // Step 2: Get current worktree/branch
  const worktreesResult = await listWorktrees(repo.path);
  if (!worktreesResult.success) {
    printError(`Error: ${worktreesResult.error}`);
    process.exit(1);
  }

  const cwd = process.cwd();
  const currentWorktree = worktreesResult.data.find(
    (wt) => cwd === wt.path || cwd.startsWith(wt.path + '/')
  );

  // Determine working directory - use worktree path if in worktree, otherwise cwd
  const workDir = currentWorktree?.path ?? cwd;

  // Get current branch
  const branchResult = await getCurrentBranch(workDir);
  if (!branchResult.success) {
    printError(`Error: ${branchResult.error}`);
    process.exit(1);
  }
  const currentBranch = branchResult.data;

  // Step 3: Check for uncommitted changes
  const changesResult = await hasUncommittedChanges(workDir);
  if (!changesResult.success) {
    printError(`Error: ${changesResult.error}`);
    process.exit(1);
  }

  if (changesResult.data) {
    printError('Error: Working directory has uncommitted changes.');
    printError('Commit or stash them first.');
    process.exit(1);
  }

  // Step 4: Determine base branch
  let baseRef: string;

  // Check if this is a stacked branch
  const parentBranch = getParentBranch(repo, currentBranch);

  if (parentBranch) {
    // Stacked branch: use parent branch directly (local ref)
    baseRef = parentBranch;
    printStatus(`Squashing commits since parent branch "${parentBranch}"...`);
  } else {
    // Non-stacked branch: use origin/default-branch
    // Fetch to ensure we have latest
    const fetchResult = await fetchOrigin(workDir);
    if (!fetchResult.success) {
      printError(`Error fetching: ${fetchResult.error}`);
      process.exit(1);
    }

    const defaultBranchResult = await getDefaultBranch(repo.path);
    if (!defaultBranchResult.success) {
      printError(`Error: ${defaultBranchResult.error}`);
      process.exit(1);
    }
    const defaultBranch = defaultBranchResult.data;
    baseRef = `origin/${defaultBranch}`;
    printStatus(`Squashing commits since "${defaultBranch}"...`);
  }

  // Step 5: Get merge base for accurate commit counting
  const mergeBaseResult = await getMergeBase(workDir, baseRef, 'HEAD');
  if (!mergeBaseResult.success) {
    printError(`Error: ${mergeBaseResult.error}`);
    process.exit(1);
  }
  const mergeBase = mergeBaseResult.data;

  // Step 6: Count commits to squash
  const countResult = await getCommitCount(workDir, mergeBase);
  if (!countResult.success) {
    printError(`Error: ${countResult.error}`);
    process.exit(1);
  }

  const commitCount = countResult.data;

  if (commitCount === 0) {
    printError('Error: No commits to squash.');
    process.exit(1);
  }

  if (commitCount === 1) {
    print('Only 1 commit since base - nothing to squash.');
    return;
  }

  printStatus(`Found ${commitCount} commits to squash.`);

  // Handle dry-run mode
  if (options.dryRun) {
    const dryRunResult = await printDryRunOutput(
      workDir,
      mergeBase,
      baseRef,
      commitCount
    );
    if (!dryRunResult.success) {
      printError(`Error: ${dryRunResult.error}`);
      process.exit(1);
    }
    return;
  }

  // Step 7: Get commit message (if using --first flag)
  let commitMessage: string | undefined = options.message;

  if (options.first && !commitMessage) {
    const firstMsgResult = await getFirstCommitMessage(workDir, mergeBase);
    if (!firstMsgResult.success) {
      printError(`Error: ${firstMsgResult.error}`);
      process.exit(1);
    }
    commitMessage = firstMsgResult.data;
    printStatus(
      `Using first commit message: "${commitMessage.split('\n')[0]}"`
    );
  }

  // Step 8: Soft reset to merge base
  const resetResult = await softResetTo(workDir, mergeBase);
  if (!resetResult.success) {
    printError(`Error: ${resetResult.error}`);
    process.exit(1);
  }

  // Step 9: Create squashed commit
  if (commitMessage) {
    const commitResult = await commitWithMessage(workDir, commitMessage);
    if (!commitResult.success) {
      printError(`Error: ${commitResult.error}`);
      // Attempt to recover: the working tree is in a reset state
      printError(
        'Hint: Your changes are staged. Run "git commit" to complete.'
      );
      process.exit(1);
    }
  } else {
    // Open editor for commit message
    const commitResult = await commitWithEditor(workDir);
    if (!commitResult.success) {
      printError(`Error: ${commitResult.error}`);
      printError(
        'Hint: Your changes are staged. Run "git commit" to complete.'
      );
      process.exit(1);
    }
  }

  print(`Squashed ${commitCount} commits into 1.`);
}
