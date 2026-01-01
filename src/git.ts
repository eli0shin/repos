import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { OperationResult } from './types.ts';

type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export async function runGitCommand(
  args: string[],
  cwd?: string
): Promise<GitCommandResult> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

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

async function directoryHasContent(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
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

export async function findGitRepos(parentDir: string): Promise<string[]> {
  try {
    const entries = await readdir(parentDir, { withFileTypes: true });
    const repos: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = join(parentDir, entry.name);
        if (await isGitRepo(fullPath)) {
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
