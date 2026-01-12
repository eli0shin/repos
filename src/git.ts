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

export async function isBareRepo(repoDir: string): Promise<boolean> {
  const result = await runGitCommand(
    ['rev-parse', '--is-bare-repository'],
    repoDir
  );
  return result.exitCode === 0 && result.stdout === 'true';
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

export type WorktreeInfo = {
  path: string;
  branch: string;
  isMain: boolean;
};

export async function listWorktrees(
  repoDir: string
): Promise<OperationResult<WorktreeInfo[]>> {
  const result = await runGitCommand(
    ['worktree', 'list', '--porcelain'],
    repoDir
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to list worktrees',
    };
  }

  const worktrees: WorktreeInfo[] = [];
  const entries = result.stdout.split('\n\n').filter(Boolean);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const lines = entry.split('\n');
    let path = '';
    let branch = '';
    let isBare = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length);
      } else if (line.startsWith('branch refs/heads/')) {
        branch = line.slice('branch refs/heads/'.length);
      } else if (line === 'bare') {
        isBare = true;
      }
    }

    // First worktree is the main one for non-bare repos
    // For bare repos, the bare entry is the main one
    const isMain = i === 0 || isBare;

    if (path) {
      worktrees.push({ path, branch, isMain });
    }
  }

  return { success: true, data: worktrees };
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

export async function createWorktree(
  repoDir: string,
  worktreePath: string,
  branch: string
): Promise<OperationResult> {
  // Check if local branch exists first
  const localExists = await localBranchExists(repoDir, branch);

  if (localExists) {
    // Branch exists locally - checkout existing branch (no -b flag)
    const args = ['worktree', 'add', worktreePath, branch];
    const result = await runGitCommand(args, repoDir);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to create worktree',
      };
    }

    return { success: true, data: undefined };
  }

  // Check if remote branch exists
  const remoteBranchResult = await runGitCommand(
    ['ls-remote', '--heads', 'origin', branch],
    repoDir
  );

  const remoteExists =
    remoteBranchResult.exitCode === 0 &&
    remoteBranchResult.stdout.includes(`refs/heads/${branch}`);

  let args: string[];

  if (remoteExists) {
    // Fetch the branch first
    await runGitCommand(['fetch', 'origin', branch], repoDir);
    // Create worktree tracking the remote branch
    args = [
      'worktree',
      'add',
      '--track',
      '-b',
      branch,
      worktreePath,
      `origin/${branch}`,
    ];
  } else {
    // Get default branch to base new branch on
    const defaultBranchResult = await getDefaultBranch(repoDir);
    if (!defaultBranchResult.success) {
      return { success: false, error: defaultBranchResult.error };
    }
    // Create new branch from origin/<default> without tracking
    // (branch doesn't exist on remote yet, so no tracking until pushed)
    args = [
      'worktree',
      'add',
      '--no-track',
      '-b',
      branch,
      worktreePath,
      `origin/${defaultBranchResult.data}`,
    ];
  }

  const result = await runGitCommand(args, repoDir);

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to create worktree',
    };
  }

  return { success: true, data: undefined };
}

export async function createWorktreeFromBranch(
  repoDir: string,
  worktreePath: string,
  newBranch: string,
  parentBranch: string
): Promise<OperationResult> {
  // Check if new branch already exists locally
  const localExists = await localBranchExists(repoDir, newBranch);
  if (localExists) {
    return {
      success: false,
      error: `Branch "${newBranch}" already exists locally`,
    };
  }

  // Check if new branch already exists on remote
  const remoteBranchResult = await runGitCommand(
    ['ls-remote', '--heads', 'origin', newBranch],
    repoDir
  );
  const remoteExists =
    remoteBranchResult.exitCode === 0 &&
    remoteBranchResult.stdout.includes(`refs/heads/${newBranch}`);

  if (remoteExists) {
    return {
      success: false,
      error: `Branch "${newBranch}" already exists on remote`,
    };
  }

  // Create worktree with new branch based on parent branch
  const result = await runGitCommand(
    [
      'worktree',
      'add',
      '--no-track',
      '-b',
      newBranch,
      worktreePath,
      parentBranch,
    ],
    repoDir
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to create worktree',
    };
  }

  return { success: true, data: undefined };
}

export async function removeWorktree(
  repoDir: string,
  worktreePath: string
): Promise<OperationResult> {
  const result = await runGitCommand(
    ['worktree', 'remove', worktreePath],
    repoDir
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to remove worktree',
    };
  }

  return { success: true, data: undefined };
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

export async function fetchOrigin(repoDir: string): Promise<OperationResult> {
  const result = await runGitCommand(['fetch', 'origin'], repoDir);

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'Failed to fetch' };
  }

  return { success: true, data: undefined };
}

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
          '  3. Continue rebase: git rebase --continue\n\n' +
          'To abort: git rebase --abort',
      };
    }
    return { success: false, error: result.stderr || 'Failed to rebase' };
  }

  return { success: true, data: undefined };
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

export async function fetchWithPrune(
  repoDir: string
): Promise<OperationResult> {
  const result = await runGitCommand(['fetch', '--prune'], repoDir);

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || 'Failed to fetch' };
  }

  return { success: true, data: undefined };
}

export type BranchUpstreamStatus = 'gone' | 'tracking' | 'local';

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
