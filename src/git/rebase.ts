import { join } from 'node:path';
import { printError } from '../output.ts';
import type { OperationResult } from '../types.ts';
import { getGitDir, readBranchFromFile, runGitCommand } from './core.ts';
import { fetchOrigin } from './remote.ts';

export async function rebaseOnBranch(
  repoDir: string,
  targetBranch: string
): Promise<OperationResult> {
  return rebaseOnRef(repoDir, `origin/${targetBranch}`);
}

export async function rebaseOnRef(
  repoDir: string,
  ref: string
): Promise<OperationResult> {
  const result = await runGitCommand(['rebase', ref], repoDir);

  if (result.exitCode !== 0) {
    if (
      result.stderr.includes('CONFLICT') ||
      result.stdout.includes('CONFLICT')
    ) {
      return {
        success: false,
        error:
          'Rebase paused due to conflicts.\n\n' +
          'To resolve:\n' +
          '  1. Fix conflicts in the affected files\n' +
          '  2. Stage resolved files: git add <file>\n' +
          '  3. Continue rebase: repos continue\n\n' +
          'To abort: git rebase --abort',
      };
    }
    return { success: false, error: result.stderr || 'Failed to rebase' };
  }

  return { success: true, data: undefined };
}

export async function rebaseOnto(
  repoDir: string,
  onto: string,
  forkPoint: string
): Promise<OperationResult> {
  const result = await runGitCommand(
    ['rebase', '--onto', onto, forkPoint],
    repoDir
  );

  if (result.exitCode !== 0) {
    if (
      result.stderr.includes('CONFLICT') ||
      result.stdout.includes('CONFLICT')
    ) {
      return {
        success: false,
        error:
          'Rebase paused due to conflicts.\n\n' +
          'To resolve:\n' +
          '  1. Fix conflicts in the affected files\n' +
          '  2. Stage resolved files: git add <file>\n' +
          '  3. Continue rebase: repos continue\n\n' +
          'To abort: git rebase --abort',
      };
    }
    return { success: false, error: result.stderr || 'Failed to rebase' };
  }

  return { success: true, data: undefined };
}

export async function rebaseContinue(
  repoDir: string
): Promise<OperationResult> {
  const result = await runGitCommand(['rebase', '--continue'], repoDir);

  if (result.exitCode !== 0) {
    if (
      result.stderr.includes('CONFLICT') ||
      result.stdout.includes('CONFLICT')
    ) {
      return {
        success: false,
        error:
          'Rebase paused due to conflicts.\n\n' +
          'To resolve:\n' +
          '  1. Fix conflicts in the affected files\n' +
          '  2. Stage resolved files: git add <file>\n' +
          '  3. Continue rebase: repos continue\n\n' +
          'To abort: git rebase --abort',
      };
    }
    return {
      success: false,
      error: result.stderr || 'Failed to continue rebase',
    };
  }

  return { success: true, data: undefined };
}

export async function fetchAndRebase(
  worktreePath: string,
  targetRef: string
): Promise<void> {
  const fetchResult = await fetchOrigin(worktreePath);
  if (!fetchResult.success) {
    printError(`Error fetching: ${fetchResult.error}`);
    process.exit(1);
  }

  const rebaseResult = await rebaseOnRef(worktreePath, targetRef);
  if (!rebaseResult.success) {
    printError(`Error: ${rebaseResult.error}`);
    process.exit(1);
  }
}

export async function isRebaseInProgress(repoDir: string): Promise<boolean> {
  // Check for rebase state by looking for REBASE_HEAD
  const checkExists = await runGitCommand(
    ['rev-parse', '--verify', '--quiet', 'REBASE_HEAD'],
    repoDir
  );

  return checkExists.exitCode === 0;
}

/**
 * Get the branch name being rebased (during an active rebase).
 * During a rebase, HEAD is detached so git worktree list doesn't show the branch.
 * We read the branch name from the rebase state file.
 */
export async function getRebaseBranch(
  repoDir: string
): Promise<OperationResult<string>> {
  const gitDir = await getGitDir(repoDir);
  if (!gitDir.success) {
    return { success: false, error: gitDir.error };
  }

  // Try rebase-merge first (used by default rebase and interactive rebase)
  const mergeBranch = await readBranchFromFile(
    join(gitDir.data, 'rebase-merge', 'head-name')
  );
  if (mergeBranch) {
    return { success: true, data: mergeBranch };
  }

  // Try rebase-apply (used by git rebase --apply)
  const applyBranch = await readBranchFromFile(
    join(gitDir.data, 'rebase-apply', 'head-name')
  );
  if (applyBranch) {
    return { success: true, data: applyBranch };
  }

  return {
    success: false,
    error: 'Could not determine branch from rebase state',
  };
}
