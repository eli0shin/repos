import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { printError } from '../output.ts';
import type { OperationResult } from '../types.ts';
import { runGitCommand } from './core.ts';
import { getDefaultBranch, localBranchExists } from './branch.ts';
import type { WorktreeInfo } from './types.ts';

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

export function findWorktreeByBranch(
  worktrees: WorktreeInfo[],
  branch: string
): WorktreeInfo | undefined {
  return worktrees.find((wt) => wt.branch === branch);
}

export function findWorktreeByDirectory(
  worktrees: WorktreeInfo[],
  directory: string
): WorktreeInfo | undefined {
  return worktrees.find(
    (wt) => directory === wt.path || directory.startsWith(wt.path + '/')
  );
}

export async function resolveWorktree(
  repoPath: string,
  branch?: string
): Promise<WorktreeInfo> {
  const result = await listWorktrees(repoPath);
  if (!result.success) {
    printError(`Error: ${result.error}`);
    process.exit(1);
  }

  if (branch) {
    const worktree = findWorktreeByBranch(result.data, branch);
    if (!worktree) {
      printError(`Error: No worktree found for branch "${branch}"`);
      process.exit(1);
    }
    return worktree;
  }

  const worktree = findWorktreeByDirectory(result.data, process.cwd());
  if (!worktree) {
    printError('Error: Not inside a worktree. Specify branch name.');
    process.exit(1);
  }
  return worktree;
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

export async function pruneWorktrees(
  repoDir: string
): Promise<OperationResult> {
  const result = await runGitCommand(['worktree', 'prune'], repoDir);
  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to prune worktrees',
    };
  }
  return { success: true, data: undefined };
}

async function getInProgressOperation(
  worktreePath: string
): Promise<string | undefined> {
  const gitDirResult = await runGitCommand(
    ['rev-parse', '--absolute-git-dir'],
    worktreePath
  );
  if (gitDirResult.exitCode !== 0) {
    return undefined;
  }
  const gitDir = gitDirResult.stdout.trim();
  console.error('[DEBUG] gitDir:', gitDir);
  try {
    const { readdirSync } = await import('node:fs');
    console.error('[DEBUG] gitDir contents:', readdirSync(gitDir).sort().join(', '));
  } catch (e) {
    console.error('[DEBUG] cannot read gitDir:', e);
  }
  const stateFiles: { file: string; label: string }[] = [
    { file: 'rebase-merge', label: 'rebase' },
    { file: 'rebase-apply', label: 'rebase' },
    { file: 'MERGE_HEAD', label: 'merge' },
    { file: 'CHERRY_PICK_HEAD', label: 'cherry-pick' },
    { file: 'REVERT_HEAD', label: 'revert' },
    { file: 'BISECT_LOG', label: 'bisect' },
  ];
  for (const { file, label } of stateFiles) {
    if (existsSync(join(gitDir, file))) {
      return label;
    }
  }
  return undefined;
}

export async function removeWorktree(
  repoDir: string,
  worktreePath: string,
  options: { force?: boolean } = {}
): Promise<OperationResult> {
  if (!options.force) {
    const inProgress = await getInProgressOperation(worktreePath);
    if (inProgress) {
      return {
        success: false,
        error: `worktree has an in-progress ${inProgress}; finish or abort it before removing`,
      };
    }
  }

  const args = options.force
    ? ['worktree', 'remove', '--force', worktreePath]
    : ['worktree', 'remove', worktreePath];
  const result = await runGitCommand(args, repoDir);

  if (result.exitCode === 0) {
    return { success: true, data: undefined };
  }

  // git's safety checks passed (clean working tree, not locked, no in-progress
  // operation) but rmdir failed because the worktree contains gitignored
  // content (e.g., node_modules, build artifacts). Finish the cleanup so the
  // end state matches a successful remove: directory gone, not tracked.
  if (!options.force && result.stderr.includes('Directory not empty')) {
    await rm(worktreePath, { recursive: true, force: true });
    const pruneResult = await runGitCommand(['worktree', 'prune'], repoDir);
    if (pruneResult.exitCode !== 0) {
      return {
        success: false,
        error: pruneResult.stderr || 'Failed to prune worktree metadata',
      };
    }
    return { success: true, data: undefined };
  }

  return {
    success: false,
    error: result.stderr || 'Failed to remove worktree',
  };
}
