import type { CommandContext } from '../cli.ts';
import { loadConfig, resolveRepo } from '../config.ts';
import {
  getDefaultBranch,
  resolveWorktree,
  fetchOrigin,
  rebaseOnto,
  rebaseOnRef,
  getBaseRef,
  setBaseRef,
  runGitCommand,
} from '../git/index.ts';
import { print, printError } from '../output.ts';

export async function rebaseCommand(
  ctx: CommandContext,
  branch?: string,
  repoName?: string
): Promise<void> {
  const config = await loadConfig(ctx.configPath);
  const repo = await resolveRepo(config, repoName);
  const worktree = await resolveWorktree(repo.path, branch);

  // Get default branch
  const defaultBranchResult = await getDefaultBranch(repo.path);
  if (!defaultBranchResult.success) {
    printError(`Error: ${defaultBranchResult.error}`);
    process.exit(1);
  }

  const defaultBranch = defaultBranchResult.data;
  const targetRef = `origin/${defaultBranch}`;

  if (!worktree.branch) {
    printError(
      'Error: Cannot rebase in detached HEAD state. Check out a branch first.'
    );
    process.exit(1);
  }

  print(`Fetching and rebasing "${worktree.branch}" on "${defaultBranch}"...`);

  const fetchResult = await fetchOrigin(worktree.path);
  if (!fetchResult.success) {
    printError(`Error fetching: ${fetchResult.error}`);
    process.exit(1);
  }

  // Use fork point for rebase if available (handles squash/rebase merges)
  const baseRefResult = await getBaseRef(repo.path, worktree.branch);
  if (baseRefResult.success) {
    const rebaseResult = await rebaseOnto(
      worktree.path,
      targetRef,
      baseRefResult.data
    );
    if (!rebaseResult.success) {
      printError(`Error: ${rebaseResult.error}`);
      process.exit(1);
    }
  } else {
    const rebaseResult = await rebaseOnRef(worktree.path, targetRef);
    if (!rebaseResult.success) {
      printError(`Error: ${rebaseResult.error}`);
      process.exit(1);
    }
  }

  // Update base ref to current target for future fork-point rebases
  // repo.path is used (not worktree.path) since refs are stored in the bare repo
  const targetCommit = await runGitCommand(
    ['rev-parse', targetRef],
    repo.path
  );
  if (targetCommit.exitCode === 0) {
    const setResult = await setBaseRef(
      repo.path,
      worktree.branch,
      targetCommit.stdout.trim()
    );
    if (!setResult.success) {
      printError(`Warning: Failed to update base ref: ${setResult.error}`);
    }
  } else {
    printError(
      `Warning: Failed to resolve ${targetRef}, base ref not updated`
    );
  }

  print(`Rebased "${worktree.branch}" on "${defaultBranch}"`);
}
