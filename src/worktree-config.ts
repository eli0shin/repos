import { join } from 'node:path';
import { listWorktrees } from './git/index.ts';
import type { WorktreeInfo } from './git/types.ts';
import type { OperationResult, RepoWorktreeConfig } from './types.ts';

type MainWorktreeResolution = {
  mainWorktreePath: string;
  usedFallback: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRepoWorktreeConfig(value: unknown): value is RepoWorktreeConfig {
  if (!isRecord(value)) return false;

  if (value.setup !== undefined) {
    if (!isRecord(value.setup)) return false;
    if (value.setup.copy !== undefined) {
      if (!Array.isArray(value.setup.copy)) return false;
      if (!value.setup.copy.every((entry) => typeof entry === 'string')) {
        return false;
      }
    }
    if (
      value.setup.command !== undefined &&
      typeof value.setup.command !== 'string'
    ) {
      return false;
    }
  }

  return true;
}

export function getWorktreeConfigPath(mainWorktreePath: string): string {
  return join(mainWorktreePath, '.repos', 'worktree.json');
}

export async function readWorktreeConfig(
  configPath: string
): Promise<OperationResult<RepoWorktreeConfig>> {
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return { success: true, data: {} };
  }

  try {
    const content: unknown = await file.json();
    if (!isRepoWorktreeConfig(content)) {
      return { success: false, error: 'Invalid worktree config file format' };
    }
    return { success: true, data: content };
  } catch {
    return { success: false, error: 'Failed to parse worktree config file' };
  }
}

export async function resolveMainWorktreePath(
  repoPath: string
): Promise<OperationResult<MainWorktreeResolution>> {
  const worktreesResult = await listWorktrees(repoPath);
  if (!worktreesResult.success) {
    return { success: false, error: worktreesResult.error };
  }

  return {
    success: true,
    data: getMainWorktreeResolution(worktreesResult.data, repoPath),
  };
}

export function getMainWorktreeResolution(
  worktrees: WorktreeInfo[],
  repoPath: string
): MainWorktreeResolution {
  const mainWorktree = worktrees.find((worktree) => worktree.isMain);
  return {
    mainWorktreePath: mainWorktree?.path ?? repoPath,
    usedFallback: !mainWorktree,
  };
}

export async function loadRepoWorktreeConfig(
  repoPath: string
): Promise<
  OperationResult<{ mainWorktreePath: string; config: RepoWorktreeConfig }>
> {
  const mainWorktreeResult = await resolveMainWorktreePath(repoPath);
  if (!mainWorktreeResult.success) {
    return mainWorktreeResult;
  }

  const configResult = await readWorktreeConfig(
    getWorktreeConfigPath(mainWorktreeResult.data.mainWorktreePath)
  );
  if (!configResult.success) {
    return configResult;
  }

  return {
    success: true,
    data: {
      mainWorktreePath: mainWorktreeResult.data.mainWorktreePath,
      config: configResult.data,
    },
  };
}
