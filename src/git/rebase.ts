import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { printError } from '../output.ts';
import type { OperationResult } from '../types.ts';
import {
  getGitDir,
  readBranchFromFile,
  runGitCommand,
  runGitCommandInteractive,
} from './core.ts';
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
  // Use interactive spawning so git can open an editor if needed
  const exitCode = await runGitCommandInteractive(
    ['rebase', '--continue'],
    repoDir
  );

  if (exitCode !== 0) {
    if (await isRebaseInProgress(repoDir)) {
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
      error: 'Rebase was aborted',
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

const REPOS_ONLY_MARKER = 'repos-only';
const REPOS_ROOT_MARKER = 'repos-root';

async function getActiveRebaseStateDir(
  repoDir: string
): Promise<OperationResult<string>> {
  const gitDirResult = await getGitDir(repoDir);
  if (!gitDirResult.success) return gitDirResult;

  for (const directory of ['rebase-merge', 'rebase-apply']) {
    const path = join(gitDirResult.data, directory);
    try {
      await access(path);
      return { success: true, data: path };
    } catch {
      // Try the other rebase backend.
    }
  }

  return { success: false, error: 'No active rebase state directory found' };
}

/**
 * Record --only inside Git's active rebase state. Git removes this marker when
 * the rebase completes, is aborted, or is quit.
 */
export async function markRebaseOnly(
  repoDir: string
): Promise<OperationResult> {
  const stateDirResult = await getActiveRebaseStateDir(repoDir);
  if (!stateDirResult.success) return stateDirResult;

  try {
    await Bun.write(join(stateDirResult.data, REPOS_ONLY_MARKER), '');
    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function markRebaseRoot(
  repoDir: string,
  rootBranch: string
): Promise<OperationResult> {
  const stateDirResult = await getActiveRebaseStateDir(repoDir);
  if (!stateDirResult.success) return stateDirResult;

  try {
    await Bun.write(join(stateDirResult.data, REPOS_ROOT_MARKER), rootBranch);
    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getRebaseRoot(
  repoDir: string
): Promise<string | undefined> {
  const stateDirResult = await getActiveRebaseStateDir(repoDir);
  if (!stateDirResult.success) return undefined;

  try {
    const rootBranch = await Bun.file(
      join(stateDirResult.data, REPOS_ROOT_MARKER)
    ).text();
    return rootBranch.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Defaults to recursive behavior for ordinary and older in-progress rebases. */
export async function shouldRebaseChildren(repoDir: string): Promise<boolean> {
  const stateDirResult = await getActiveRebaseStateDir(repoDir);
  if (!stateDirResult.success) return true;

  try {
    await access(join(stateDirResult.data, REPOS_ONLY_MARKER));
    return false;
  } catch {
    return true;
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
