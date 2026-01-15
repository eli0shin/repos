import type { OperationResult } from '../types.ts';
import { directoryHasContent, runGitCommand } from './core.ts';
import { getCurrentBranch } from './branch.ts';

export async function pullCurrentBranch(
  repoDir: string
): Promise<OperationResult<{ updated: boolean }>> {
  const result = await runGitCommand(['pull'], repoDir);

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'Failed to pull' };
  }

  const updated = !result.stdout.includes('Already up to date');
  return { success: true, data: { updated } };
}

export async function cloneRepo(
  url: string,
  targetDir: string
): Promise<OperationResult<{ branch: string }>> {
  if (await directoryHasContent(targetDir)) {
    return {
      success: false,
      error: 'Target directory already exists and is not empty',
    };
  }

  const result = await runGitCommand(['clone', url, targetDir]);

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'Failed to clone' };
  }

  const branchResult = await getCurrentBranch(targetDir);
  if (!branchResult.success) {
    return { success: false, error: 'Cloned but failed to get branch' };
  }

  return { success: true, data: { branch: branchResult.data } };
}

export async function cloneBare(
  url: string,
  targetDir: string
): Promise<OperationResult> {
  if (await directoryHasContent(targetDir)) {
    return {
      success: false,
      error: 'Target directory already exists and is not empty',
    };
  }

  const result = await runGitCommand(['clone', '--bare', url, targetDir]);

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'Failed to clone' };
  }

  return { success: true, data: undefined };
}

export async function fetchOrigin(repoDir: string): Promise<OperationResult> {
  const result = await runGitCommand(['fetch', 'origin'], repoDir);

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'Failed to fetch' };
  }

  return { success: true, data: undefined };
}

export async function fetchWithPrune(
  repoDir: string
): Promise<OperationResult> {
  const result = await runGitCommand(['fetch', '--prune'], repoDir);

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'Failed to fetch' };
  }

  return { success: true, data: undefined };
}

export async function ensureRefspecConfig(
  repoDir: string
): Promise<OperationResult> {
  // Check if remote.origin.fetch is configured correctly
  const check = await runGitCommand(
    ['config', '--get', 'remote.origin.fetch'],
    repoDir
  );

  // If not configured or doesn't have the standard refspec for remote tracking
  if (check.exitCode !== 0 || !check.stdout.includes('refs/remotes/origin')) {
    await runGitCommand(
      ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'],
      repoDir
    );
    await runGitCommand(['fetch', 'origin'], repoDir);
  }

  return { success: true, data: undefined };
}
