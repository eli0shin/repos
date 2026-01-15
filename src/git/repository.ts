import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { OperationResult } from '../types.ts';
import { runGitCommand } from './core.ts';

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const result = await runGitCommand(
      ['rev-parse', '--is-inside-work-tree'],
      dir
    );
    return result.exitCode === 0 && result.stdout === 'true';
  } catch {
    return false;
  }
}

export async function isBareRepo(repoDir: string): Promise<boolean> {
  const result = await runGitCommand(
    ['rev-parse', '--is-bare-repository'],
    repoDir
  );
  return result.exitCode === 0 && result.stdout === 'true';
}

export async function isGitRepoOrBare(dir: string): Promise<boolean> {
  return (await isGitRepo(dir)) || (await isBareRepo(dir));
}

export async function findGitRepos(parentDir: string): Promise<string[]> {
  try {
    const entries = await readdir(parentDir, { withFileTypes: true });
    const repos: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = join(parentDir, entry.name);
        if (await isGitRepoOrBare(fullPath)) {
          repos.push(entry.name);
        }
      }
    }

    return repos;
  } catch {
    return [];
  }
}

export async function getRemoteUrl(
  repoDir: string
): Promise<OperationResult<string>> {
  const result = await runGitCommand(['remote', 'get-url', 'origin'], repoDir);

  if (result.exitCode !== 0) {
    return { success: false, error: 'No remote origin found' };
  }

  return { success: true, data: result.stdout };
}

export async function getHeadCommit(
  repoDir: string
): Promise<OperationResult<string>> {
  const result = await runGitCommand(['rev-parse', 'HEAD'], repoDir);

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to get HEAD commit',
    };
  }

  return { success: true, data: result.stdout.trim() };
}
