import { mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  listWorktrees,
  findWorktreeByDirectory,
  getGitRepoRoot,
  getRemoteUrl,
  isLinkedWorktreeRoot,
} from './git/index.ts';
import { printError, printStatus } from './output.ts';
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

export async function loadConfig(configPath: string): Promise<ReposConfig> {
  const result = await readConfig(configPath);
  if (!result.success) {
    printError(`Error reading config: ${result.error}`);
    process.exit(1);
  }
  return result.data;
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
      if (findWorktreeByDirectory(worktreesResult.data, cwd)) {
        return repo;
      }
    }
  }

  return undefined;
}

export async function resolveRepo(
  config: ReposConfig,
  repoName?: string
): Promise<RepoEntry> {
  if (repoName) {
    const repo = findRepo(config, repoName);
    if (!repo) {
      printError(`Error: "${repoName}" not found in config`);
      process.exit(1);
    }
    return repo;
  }
  const repo = await findRepoFromCwd(config, process.cwd());
  if (!repo) {
    printError('Error: Not inside a tracked repo. Specify repo name.');
    process.exit(1);
  }
  return repo;
}

export type ResolvedRepoFromCwd = {
  repo: RepoEntry;
  config: ReposConfig;
};

export async function resolveRepoWithConfig(
  configPath: string,
  config: ReposConfig,
  repoName?: string
): Promise<ResolvedRepoFromCwd> {
  if (repoName) {
    const repo = findRepo(config, repoName);
    if (!repo) {
      printError(`Error: "${repoName}" not found in config`);
      process.exit(1);
    }
    return { repo, config };
  }

  return resolveRepoFromCwd(configPath, config);
}

export async function resolveRepoFromCwd(
  configPath: string,
  config: ReposConfig
): Promise<ResolvedRepoFromCwd> {
  const cwd = process.cwd();
  const trackedRepo = await findRepoFromCwd(config, cwd);
  if (trackedRepo) return { repo: trackedRepo, config };

  const rootResult = await getGitRepoRoot(cwd);
  if (!rootResult.success) {
    printError('Error: Not inside a tracked repo.');
    process.exit(1);
  }

  const repoPath = await realpath(rootResult.data);
  if (await isLinkedWorktreeRoot(repoPath)) {
    printError('Error: Cannot auto-adopt from inside a linked worktree.');
    process.exit(1);
  }

  const name = basename(repoPath);
  const existingRepo = findRepo(config, name);
  if (existingRepo) {
    printError(
      `Error: Cannot auto-adopt "${name}" because that name is already tracked at ${existingRepo.path}`
    );
    process.exit(1);
  }

  const urlResult = await getRemoteUrl(repoPath);
  if (!urlResult.success) {
    printError('Error: Cannot auto-adopt repo without remote origin.');
    process.exit(1);
  }

  const repo = {
    name,
    url: urlResult.data,
    path: repoPath,
  } satisfies RepoEntry;
  const newConfig = addRepoToConfig(config, repo);
  await saveConfig(configPath, newConfig);
  printStatus(`Auto-adopted "${name}"`);
  return { repo, config: newConfig };
}

export function getWorktreePath(repoPath: string, branch: string): string {
  const parentDir = dirname(repoPath);
  const repoName = basename(repoPath);
  const safeBranch = branch.replace(/\//g, '-');
  return join(parentDir, `${repoName}-${safeBranch}`);
}

export async function saveConfig(
  configPath: string,
  config: ReposConfig
): Promise<void> {
  const result = await writeConfig(configPath, config);
  if (!result.success) {
    printError(`Error saving config: ${result.error}`);
    process.exit(1);
  }
}

export function getUpdateBehavior(config: ReposConfig): UpdateBehavior {
  return config.config?.updateBehavior ?? 'auto';
}

export function getUpdateCheckInterval(config: ReposConfig): number {
  return config.config?.updateCheckIntervalHours ?? 24;
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
