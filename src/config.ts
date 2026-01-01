import type { RepoEntry, ReposConfig, OperationResult } from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRepoEntry(value: unknown): value is RepoEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    typeof value.url === 'string' &&
    typeof value.branch === 'string'
  );
}

function isReposConfig(value: unknown): value is ReposConfig {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.repos)) return false;
  return value.repos.every(isRepoEntry);
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
    repos: [...config.repos, repo],
  };
}

export function removeRepoFromConfig(
  config: ReposConfig,
  name: string
): ReposConfig {
  return {
    repos: config.repos.filter((r) => r.name !== name),
  };
}

export function updateRepoBranch(
  config: ReposConfig,
  name: string,
  branch: string
): ReposConfig {
  const repo = config.repos.find((r) => r.name === name);
  if (!repo) {
    return config;
  }

  return {
    repos: config.repos.map((r) => (r.name === name ? { ...r, branch } : r)),
  };
}

export function findRepo(
  config: ReposConfig,
  name: string
): RepoEntry | undefined {
  return config.repos.find((r) => r.name === name);
}
