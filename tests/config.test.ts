import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  extractRepoName,
  readConfig,
  writeConfig,
  addRepoToConfig,
  removeRepoFromConfig,
  updateRepoBranch,
  findRepo,
} from '../src/config.ts';
import type { ReposConfig, RepoEntry } from '../src/types.ts';

describe('extractRepoName', () => {
  test('extracts name from SSH URL with .git suffix', () => {
    const result = extractRepoName('git@github.com:user/my-repo.git');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('my-repo');
    }
  });

  test('extracts name from SSH URL without .git suffix', () => {
    const result = extractRepoName('git@github.com:user/my-repo');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('my-repo');
    }
  });

  test('extracts name from HTTPS URL with .git suffix', () => {
    const result = extractRepoName('https://github.com/user/my-repo.git');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('my-repo');
    }
  });

  test('extracts name from HTTPS URL without .git suffix', () => {
    const result = extractRepoName('https://github.com/user/my-repo');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('my-repo');
    }
  });

  test('extracts name from GitLab SSH URL', () => {
    const result = extractRepoName('git@gitlab.com:group/subgroup/project.git');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('project');
    }
  });

  test('extracts name from self-hosted git URL', () => {
    const result = extractRepoName('git@git.company.com:team/service.git');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('service');
    }
  });

  test('returns error for empty URL', () => {
    const result = extractRepoName('');
    expect(result.success).toBe(false);
  });

  test('returns error for URL without repo name', () => {
    const result = extractRepoName('https://github.com/');
    expect(result.success).toBe(false);
  });
});

describe('config manipulation functions', () => {
  const sampleRepo = {
    name: 'test-repo',
    url: 'git@github.com:user/test-repo.git',
    branch: 'main',
  } satisfies RepoEntry;

  describe('addRepoToConfig', () => {
    test('adds repo to empty config', () => {
      const emptyConfig = { repos: [] } satisfies ReposConfig;
      const result = addRepoToConfig(emptyConfig, sampleRepo);
      expect(result.repos).toHaveLength(1);
      expect(result.repos[0]).toEqual(sampleRepo);
    });

    test('adds repo to existing config', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      const newRepo = {
        name: 'another-repo',
        url: 'git@github.com:user/another-repo.git',
        branch: 'develop',
      } satisfies RepoEntry;
      const result = addRepoToConfig(configWithRepo, newRepo);
      expect(result.repos).toHaveLength(2);
      expect(result.repos[1]).toEqual(newRepo);
    });

    test('does not mutate original config', () => {
      const emptyConfig = { repos: [] } satisfies ReposConfig;
      addRepoToConfig(emptyConfig, sampleRepo);
      expect(emptyConfig.repos).toHaveLength(0);
    });
  });

  describe('removeRepoFromConfig', () => {
    test('removes repo by name', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      const result = removeRepoFromConfig(configWithRepo, 'test-repo');
      expect(result.repos).toHaveLength(0);
    });

    test('returns unchanged config if repo not found', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      const result = removeRepoFromConfig(configWithRepo, 'nonexistent');
      expect(result.repos).toHaveLength(1);
    });

    test('does not mutate original config', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      removeRepoFromConfig(configWithRepo, 'test-repo');
      expect(configWithRepo.repos).toHaveLength(1);
    });
  });

  describe('updateRepoBranch', () => {
    test('updates branch for existing repo', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      const result = updateRepoBranch(configWithRepo, 'test-repo', 'develop');
      expect(result.repos[0].branch).toBe('develop');
    });

    test('returns unchanged config if repo not found', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      const result = updateRepoBranch(configWithRepo, 'nonexistent', 'develop');
      expect(result).toEqual(configWithRepo);
    });

    test('does not mutate original config', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      updateRepoBranch(configWithRepo, 'test-repo', 'develop');
      expect(configWithRepo.repos[0].branch).toBe('main');
    });
  });

  describe('findRepo', () => {
    test('finds repo by name', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      const result = findRepo(configWithRepo, 'test-repo');
      expect(result).toEqual(sampleRepo);
    });

    test('returns undefined if not found', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      const result = findRepo(configWithRepo, 'nonexistent');
      expect(result).toBeUndefined();
    });
  });
});

describe('config file operations', () => {
  const testDir = '/tmp/repos-test-config';
  const testConfigPath = join(testDir, 'repos.json');

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('readConfig', () => {
    test('returns empty config if file does not exist', async () => {
      const result = await readConfig(testConfigPath);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.repos).toHaveLength(0);
      }
    });

    test('reads existing config file', async () => {
      const config = {
        repos: [
          { name: 'test', url: 'git@github.com:user/test.git', branch: 'main' },
        ],
      } satisfies ReposConfig;
      await Bun.write(testConfigPath, JSON.stringify(config, null, 2));

      const result = await readConfig(testConfigPath);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.repos).toHaveLength(1);
        expect(result.data.repos[0].name).toBe('test');
      }
    });

    test('returns error for invalid JSON', async () => {
      await Bun.write(testConfigPath, 'not valid json');

      const result = await readConfig(testConfigPath);
      expect(result.success).toBe(false);
    });
  });

  describe('writeConfig', () => {
    test('writes config to file', async () => {
      const config = {
        repos: [
          { name: 'test', url: 'git@github.com:user/test.git', branch: 'main' },
        ],
      } satisfies ReposConfig;

      const result = await writeConfig(testConfigPath, config);
      expect(result.success).toBe(true);

      const readResult = await readConfig(testConfigPath);
      expect(readResult.success).toBe(true);
      if (readResult.success) {
        expect(readResult.data.repos).toHaveLength(1);
        expect(readResult.data.repos[0].name).toBe('test');
      }
    });

    test('overwrites existing config', async () => {
      const config1 = {
        repos: [{ name: 'old', url: 'u', branch: 'b' }],
      } satisfies ReposConfig;
      const config2 = {
        repos: [{ name: 'new', url: 'u', branch: 'b' }],
      } satisfies ReposConfig;

      await writeConfig(testConfigPath, config1);
      await writeConfig(testConfigPath, config2);

      const readResult = await readConfig(testConfigPath);
      expect(readResult.success).toBe(true);
      if (readResult.success) {
        expect(readResult.data.repos[0].name).toBe('new');
      }
    });
  });
});
