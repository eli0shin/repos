import type { OperationResult } from '../types.ts';
import { runGitCommand } from './core.ts';
import type { BranchUpstreamStatus } from './types.ts';

export async function getCurrentBranch(
  repoDir: string
): Promise<OperationResult<string>> {
  const result = await runGitCommand(
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    repoDir
  );

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'Failed to get branch' };
  }

  return { success: true, data: result.stdout };
}

export async function getDefaultBranch(
  repoDir: string
): Promise<OperationResult<string>> {
  // Try to get from remote HEAD
  const remoteResult = await runGitCommand(
    ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
    repoDir
  );

  if (remoteResult.exitCode === 0) {
    // Returns "origin/main" - strip "origin/" prefix
    const branch = remoteResult.stdout.replace(/^origin\//, '');
    return { success: true, data: branch };
  }

  // Fallback: try to get local HEAD
  const localResult = await runGitCommand(
    ['symbolic-ref', 'HEAD', '--short'],
    repoDir
  );

  if (localResult.exitCode === 0) {
    return { success: true, data: localResult.stdout };
  }

  return { success: false, error: 'Could not determine default branch' };
}

export async function localBranchExists(
  repoDir: string,
  branch: string
): Promise<boolean> {
  const result = await runGitCommand(
    ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
    repoDir
  );
  return result.exitCode === 0;
}

export async function hasUncommittedChanges(
  repoDir: string
): Promise<OperationResult<boolean>> {
  const result = await runGitCommand(['status', '--porcelain'], repoDir);

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'Failed to check status' };
  }

  return { success: true, data: result.stdout.length > 0 };
}

export async function getBranchUpstreamStatus(
  repoDir: string,
  branch: string
): Promise<OperationResult<BranchUpstreamStatus>> {
  // Get upstream and track status for the branch
  const result = await runGitCommand(
    [
      'for-each-ref',
      '--format=%(upstream) %(upstream:track)',
      `refs/heads/${branch}`,
    ],
    repoDir
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to get branch status',
    };
  }

  const output = result.stdout.trim();

  // Empty output means no upstream configured (local-only branch)
  if (output === '') {
    return { success: true, data: 'local' };
  }

  // Check if upstream is gone
  if (output.includes('[gone]')) {
    return { success: true, data: 'gone' };
  }

  // Has upstream and it exists
  return { success: true, data: 'tracking' };
}

export async function isBranchContentMerged(
  repoDir: string,
  branch: string,
  targetBranch: string
): Promise<OperationResult<boolean>> {
  // Use git cherry to detect if branch commits have been applied to target
  // Works for squash merges, rebase merges, and cherry-picks
  const result = await runGitCommand(
    ['cherry', `origin/${targetBranch}`, branch],
    repoDir
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to check cherry status',
    };
  }

  // Empty output means no commits to compare (branch is at same point or merged)
  if (result.stdout === '') {
    return { success: true, data: true };
  }

  // Lines starting with + are commits NOT yet applied
  // Lines starting with - are commits already applied (equivalent patch exists)
  // If any line starts with +, the branch has unapplied commits
  const lines = result.stdout.split('\n').filter(Boolean);
  const hasUnappliedCommits = lines.some((line) => line.startsWith('+'));

  return { success: true, data: !hasUnappliedCommits };
}

export async function getBranchesContaining(
  repoDir: string,
  commitRef: string
): Promise<OperationResult<string[]>> {
  const result = await runGitCommand(
    ['branch', '--contains', commitRef, '--format=%(refname:short)'],
    repoDir
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to get branches containing commit',
    };
  }

  const branches = result.stdout
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean);

  return { success: true, data: branches };
}
