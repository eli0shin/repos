import type { OperationResult } from '../types.ts';
import { runGitCommand } from './core.ts';

// Base ref helpers for stacked branch fork point tracking
// These refs store the commit hash of the parent branch at the time of stacking
// to enable correct rebase --onto behavior after parent is rebased/squashed

export async function getBaseRef(
  repoDir: string,
  branch: string
): Promise<OperationResult<string>> {
  const result = await runGitCommand(
    ['rev-parse', `refs/bases/${branch}`],
    repoDir
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: `No base ref found for branch "${branch}"`,
    };
  }

  return { success: true, data: result.stdout.trim() };
}

export async function setBaseRef(
  repoDir: string,
  branch: string,
  commit: string
): Promise<OperationResult> {
  const result = await runGitCommand(
    ['update-ref', `refs/bases/${branch}`, commit],
    repoDir
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to set base ref',
    };
  }

  return { success: true, data: undefined };
}

export async function deleteBaseRef(
  repoDir: string,
  branch: string
): Promise<OperationResult> {
  const result = await runGitCommand(
    ['update-ref', '-d', `refs/bases/${branch}`],
    repoDir
  );

  // Ignore errors if ref doesn't exist
  if (result.exitCode !== 0 && !result.stderr.includes('not found')) {
    return {
      success: false,
      error: result.stderr || 'Failed to delete base ref',
    };
  }

  return { success: true, data: undefined };
}

export async function computeForkPoint(
  repoDir: string,
  childBranch: string,
  parentBranch: string
): Promise<OperationResult<string>> {
  // Get commits in child not reachable from parent
  // This only works correctly BEFORE parent is rebased
  const log = await runGitCommand(
    ['log', `${parentBranch}..${childBranch}`, '--format=%H'],
    repoDir
  );

  if (log.exitCode !== 0) {
    return {
      success: false,
      error: log.stderr || 'Failed to compute fork point',
    };
  }

  const commits = log.stdout.trim().split('\n').filter(Boolean);

  if (commits.length === 0) {
    // No unique commits, fork point is the parent branch
    const parentHead = await runGitCommand(
      ['rev-parse', parentBranch],
      repoDir
    );
    if (parentHead.exitCode !== 0) {
      return { success: false, error: 'Failed to resolve parent branch' };
    }
    return { success: true, data: parentHead.stdout.trim() };
  }

  // The fork point is the parent of the oldest unique commit
  const oldest = commits[commits.length - 1];
  const forkPoint = await runGitCommand(['rev-parse', `${oldest}^`], repoDir);

  if (forkPoint.exitCode !== 0) {
    return {
      success: false,
      error: forkPoint.stderr || 'Failed to get fork point parent',
    };
  }

  return { success: true, data: forkPoint.stdout.trim() };
}
