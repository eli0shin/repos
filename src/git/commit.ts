import type { OperationResult } from '../types.ts';
import { runGitCommand } from './core.ts';
import type { CommitInfo } from './types.ts';

export async function getCommitCount(
  repoDir: string,
  base: string
): Promise<OperationResult<number>> {
  const result = await runGitCommand(
    ['rev-list', '--count', `${base}..HEAD`],
    repoDir
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to count commits',
    };
  }

  const count = parseInt(result.stdout, 10);
  if (isNaN(count)) {
    return { success: false, error: 'Invalid commit count' };
  }

  return { success: true, data: count };
}

export async function getFirstCommitMessage(
  repoDir: string,
  base: string
): Promise<OperationResult<string>> {
  // Get the first commit hash after base (oldest commit in the range)
  const hashResult = await runGitCommand(
    ['rev-list', '--reverse', `${base}..HEAD`],
    repoDir
  );

  if (hashResult.exitCode !== 0 || !hashResult.stdout) {
    return { success: false, error: 'No commits found' };
  }

  const firstCommitHash = hashResult.stdout.split('\n')[0];

  const msgResult = await runGitCommand(
    ['log', '-1', '--format=%B', firstCommitHash],
    repoDir
  );

  if (msgResult.exitCode !== 0) {
    return {
      success: false,
      error: msgResult.stderr || 'Failed to get commit message',
    };
  }

  return { success: true, data: msgResult.stdout.trim() };
}

export async function getCommitList(
  repoDir: string,
  base: string
): Promise<OperationResult<CommitInfo[]>> {
  // Use %x00 (git's null byte format specifier) for delimiter
  const format = '%H%x00%h%x00%s%x00%an%x00%ar';

  const result = await runGitCommand(
    ['log', `${base}..HEAD`, `--format=${format}`],
    repoDir
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to get commit list',
    };
  }

  if (!result.stdout) {
    return { success: true, data: [] };
  }

  const commits = result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, subject, author, date] = line.split('\x00');
      return { hash, shortHash, subject, author, date };
    });

  return { success: true, data: commits };
}

export async function getCommitInfo(
  repoDir: string,
  commitRef: string
): Promise<OperationResult<CommitInfo>> {
  // Use %x00 (git's null byte format specifier) for delimiter
  const format = '%H%x00%h%x00%s%x00%an%x00%ar';

  const result = await runGitCommand(
    ['log', '-1', `--format=${format}`, commitRef],
    repoDir
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to get commit info',
    };
  }

  const [hash, shortHash, subject, author, date] = result.stdout
    .trim()
    .split('\x00');
  return { success: true, data: { hash, shortHash, subject, author, date } };
}

export async function getMergeBase(
  repoDir: string,
  ref1: string,
  ref2: string
): Promise<OperationResult<string>> {
  const result = await runGitCommand(['merge-base', ref1, ref2], repoDir);

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to find merge base',
    };
  }

  return { success: true, data: result.stdout.trim() };
}

export async function softResetTo(
  repoDir: string,
  ref: string
): Promise<OperationResult> {
  const result = await runGitCommand(['reset', '--soft', ref], repoDir);

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'Failed to reset' };
  }

  return { success: true, data: undefined };
}

export async function commitWithMessage(
  repoDir: string,
  message: string
): Promise<OperationResult> {
  const result = await runGitCommand(['commit', '-m', message], repoDir);

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'Failed to commit' };
  }

  return { success: true, data: undefined };
}

export async function commitWithEditor(
  repoDir: string
): Promise<OperationResult> {
  // Use Bun.spawn with stdio: 'inherit' to allow interactive editor
  const proc = Bun.spawn(['git', 'commit'], {
    cwd: repoDir,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    return { success: false, error: 'Commit cancelled or failed' };
  }

  return { success: true, data: undefined };
}
