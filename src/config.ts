import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { listWorktrees } from './git.ts';
import type {
  RepoEntry,
  ReposConfig,
  OperationResult,
  UpdateBehavior,
  StackEntry,
} from './types.ts';

export function getConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const configDir = xdgConfigHome
    ? join(xdgConfigHome, 'repos')
    : join(homedir(), '.config', 'repos');
  return join(configDir, 'config.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStackEntry(value: unknown): value is StackEntry {
  if (!isRecord(value)) return false;
  return typeof value.parent === 'string' && typeof value.child === 'string';
}

function isRepoEntry(value: unknown): value is RepoEntry {
  if (!isRecord(value)) return false;
  if (typeof value.name !== 'string') return false;
  if (typeof value.url !== 'string') return false;
  if (typeof value.path !== 'string') return false;
  if (value.bare !== undefined && typeof value.bare !== 'boolean') return false;
  if (value.stacks !== undefined) {
    if (!Array.isArray(value.stacks)) return false;
    if (!value.stacks.every(isStackEntry)) return false;
  }
  return true;
}

function isValidUpdateBehavior(value: unknown): boolean {
  return value === 'auto' || value === 'notify' || value === 'off';
}

function isReposConfig(value: unknown): value is ReposConfig {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.repos)) return false;
  if (!value.repos.every(isRepoEntry)) return false;

  if (value.config !== undefined) {
    if (!isRecord(value.config)) return false;
    if (
      value.config.updateBehavior !== undefined &&
      !isValidUpdateBehavior(value.config.updateBehavior)
    ) {
      return false;
    }
    if (
      value.config.updateCheckIntervalHours !== undefined &&
      typeof value.config.updateCheckIntervalHours !== 'number'
    ) {
      return false;
    }
  }

  return true;
}

export function extractRepoName(url: string): OperationResult<string> {
  if (!url) {
    return { success: false, error: 'URL is empty' };
  }

  // Handle SSH URLs: git@github.com:user/repo.git
  const sshMatch = url.match(/:([^/]+\/)*([^/]+?)(\.git)?$/);
  if (sshMatch) {
    const name = sshMatch[2];
    if (name) {
      return { success: true, data: name };
    }
  }

  // Handle HTTPS URLs: https://github.com/user/repo.git
  const httpsMatch = url.match(/\/([^/]+?)(\.git)?$/);
  if (httpsMatch) {
    const name = httpsMatch[1];
    if (name) {
      return { success: true, data: name };
    }
  }

  return { success: false, error: 'Could not extract repo name from URL' };
}

export async function readConfig(
  configPath: string
): Promise<OperationResult<ReposConfig>> {
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return { success: true, data: { repos: [] } };
  }

  try {
    const content: unknown = await file.json();
    if (!isReposConfig(content)) {
      return { success: false, error: 'Invalid config file format' };
    }
    return { success: true, data: content };
  } catch {
    return { success: false, error: 'Failed to parse config file' };
  }
}

export async function writeConfig(
  configPath: string,
  config: ReposConfig
): Promise<OperationResult> {
  try {
    await mkdir(dirname(configPath), { recursive: true });
    await Bun.write(configPath, JSON.stringify(config, null, 2) + '\n');
    return { success: true, data: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: `Failed to write config: ${message}` };
  }
}

export function addRepoToConfig(
  config: ReposConfig,
  repo: RepoEntry
): ReposConfig {
  return {
    ...config,
    repos: [...config.repos, repo],
  };
}

export function removeRepoFromConfig(
  config: ReposConfig,
  name: string
): ReposConfig {
  return {
    ...config,
    repos: config.repos.filter((r) => r.name !== name),
  };
}

export function findRepo(
  config: ReposConfig,
  name: string
): RepoEntry | undefined {
  return config.repos.find((r) => r.name === name);
}

export async function findRepoFromCwd(
  config: ReposConfig,
  cwd: string
): Promise<RepoEntry | undefined> {
  // First check if cwd is directly a tracked repo path or inside one
  for (const repo of config.repos) {
    if (cwd === repo.path || cwd.startsWith(repo.path + '/')) {
      return repo;
    }
  }

  // Check if cwd is inside a worktree of a tracked repo
  for (const repo of config.repos) {
    const worktreesResult = await listWorktrees(repo.path);
    if (worktreesResult.success) {
      for (const wt of worktreesResult.data) {
        if (cwd === wt.path || cwd.startsWith(wt.path + '/')) {
          return repo;
        }
      }
    }
  }

  return undefined;
}

export function getWorktreePath(repoPath: string, branch: string): string {
  const parentDir = dirname(repoPath);
  const repoName = basename(repoPath);
  const safeBranch = branch.replace(/\//g, '-');
  return join(parentDir, `${repoName}-${safeBranch}`);
}

export function getUpdateBehavior(config: ReposConfig): UpdateBehavior {
  return config.config?.updateBehavior ?? 'auto';
}

export function getUpdateCheckInterval(config: ReposConfig): number {
  return config.config?.updateCheckIntervalHours ?? 24;
}

// Find parent of a child branch
export function getParentBranch(
  repo: RepoEntry,
  branch: string
): string | undefined {
  return repo.stacks?.find((s) => s.child === branch)?.parent;
}

// Find all children of a parent branch
export function getChildBranches(repo: RepoEntry, branch: string): string[] {
  return (
    repo.stacks?.filter((s) => s.parent === branch).map((s) => s.child) ?? []
  );
}

// Add a stack relationship
export function addStackEntry(
  repo: RepoEntry,
  parent: string,
  child: string
): RepoEntry {
  return {
    ...repo,
    stacks: [...(repo.stacks ?? []), { parent, child }],
  };
}

// Remove a stack relationship (by child)
export function removeStackEntry(repo: RepoEntry, child: string): RepoEntry {
  if (!repo.stacks) return repo;
  const filtered = repo.stacks.filter((s) => s.child !== child);
  if (filtered.length === 0) {
    const { stacks: _, ...rest } = repo;
    return rest;
  }
  return { ...repo, stacks: filtered };
}

// Helper to update a repo in the config
export function updateRepoInConfig(
  config: ReposConfig,
  updatedRepo: RepoEntry
): ReposConfig {
  return {
    ...config,
    repos: config.repos.map((r) =>
      r.name === updatedRepo.name ? updatedRepo : r
    ),
  };
}
