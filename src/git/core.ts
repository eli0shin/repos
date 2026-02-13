import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitCommandResult } from './types.ts';

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

export async function directoryHasContent(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function getGitDir(
  repoDir: string
): Promise<
  { success: true; data: string } | { success: false; error: string }
> {
  const result = await runGitCommand(['rev-parse', '--git-dir'], repoDir);
  if (result.exitCode !== 0) {
    return { success: false, error: 'Not a git repository' };
  }
  const gitDir = result.stdout.trim();
  // If relative, make absolute
  if (!gitDir.startsWith('/')) {
    return { success: true, data: join(repoDir, gitDir) };
  }
  return { success: true, data: gitDir };
}

export async function readBranchFromFile(
  path: string
): Promise<string | undefined> {
  try {
    const content = await Bun.file(path).text();
    const branch = content.trim().replace(/^refs\/heads\//, '');
    return branch || undefined;
  } catch {
    return undefined;
  }
}
