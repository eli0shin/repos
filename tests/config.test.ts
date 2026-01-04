import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  extractRepoName,
  getConfigPath,
  readConfig,
  writeConfig,
  addRepoToConfig,
  removeRepoFromConfig,
  findRepo,
} from '../src/config.ts';
import type { ReposConfig, RepoEntry } from '../src/types.ts';
import { objectContaining } from './helpers.ts';

describe('getConfigPath', () => {
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
  });

  test('uses XDG_CONFIG_HOME when set', () => {
    process.env.XDG_CONFIG_HOME = '/custom/config';
    expect(getConfigPath()).toBe('/custom/config/repos/config.json');
  });

  test('falls back to ~/.config when XDG_CONFIG_HOME not set', () => {
    delete process.env.XDG_CONFIG_HOME;
    expect(getConfigPath()).toBe(
      join(homedir(), '.config', 'repos', 'config.json')
    );
  });
});

describe('extractRepoName', () => {
  test('extracts name from SSH URL with .git suffix', () => {
    expect(extractRepoName('git@github.com:user/my-repo.git')).toEqual({
      success: true,
      data: 'my-repo',
    });
  });

  test('extracts name from SSH URL without .git suffix', () => {
    expect(extractRepoName('git@github.com:user/my-repo')).toEqual({
      success: true,
      data: 'my-repo',
    });
  });

  test('extracts name from HTTPS URL with .git suffix', () => {
    expect(extractRepoName('https://github.com/user/my-repo.git')).toEqual({
      success: true,
      data: 'my-repo',
    });
  });

  test('extracts name from HTTPS URL without .git suffix', () => {
    expect(extractRepoName('https://github.com/user/my-repo')).toEqual({
      success: true,
      data: 'my-repo',
    });
  });

  test('extracts name from GitLab SSH URL', () => {
    expect(
      extractRepoName('git@gitlab.com:group/subgroup/project.git')
    ).toEqual({
      success: true,
      data: 'project',
    });
  });

  test('extracts name from self-hosted git URL', () => {
    expect(extractRepoName('git@git.company.com:team/service.git')).toEqual({
      success: true,
      data: 'service',
    });
  });

  test('returns error for empty URL', () => {
    expect(extractRepoName('')).toEqual({
      success: false,
      error: 'URL is empty',
    });
  });

  test('returns error for URL without repo name', () => {
    expect(extractRepoName('https://github.com/')).toEqual({
      success: false,
      error: 'Could not extract repo name from URL',
    });
  });
});

describe('config manipulation functions', () => {
  const sampleRepo = {
    name: 'test-repo',
    url: 'git@github.com:user/test-repo.git',
    path: '/home/user/code/test-repo',
  } satisfies RepoEntry;

  describe('addRepoToConfig', () => {
    test('adds repo to empty config', () => {
      const emptyConfig = { repos: [] } satisfies ReposConfig;
      expect(addRepoToConfig(emptyConfig, sampleRepo)).toEqual({
        repos: [sampleRepo],
      });
    });

    test('adds repo to existing config', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      const newRepo = {
        name: 'another-repo',
        url: 'git@github.com:user/another-repo.git',
        path: '/home/user/code/another-repo',
      } satisfies RepoEntry;
      expect(addRepoToConfig(configWithRepo, newRepo)).toEqual({
        repos: [sampleRepo, newRepo],
      });
    });

    test('does not mutate original config', () => {
      const emptyConfig = { repos: [] } satisfies ReposConfig;
      addRepoToConfig(emptyConfig, sampleRepo);
      expect(emptyConfig).toEqual({ repos: [] });
    });
  });

  describe('removeRepoFromConfig', () => {
    test('removes repo by name', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      expect(removeRepoFromConfig(configWithRepo, 'test-repo')).toEqual({
        repos: [],
      });
    });

    test('returns unchanged config if repo not found', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      expect(removeRepoFromConfig(configWithRepo, 'nonexistent')).toEqual({
        repos: [sampleRepo],
      });
    });

    test('does not mutate original config', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      removeRepoFromConfig(configWithRepo, 'test-repo');
      expect(configWithRepo).toEqual({ repos: [sampleRepo] });
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
      expect(await readConfig(testConfigPath)).toEqual({
        success: true,
        data: { repos: [] },
      });
    });

    test('reads existing config file', async () => {
      const config = {
        repos: [
          {
            name: 'test',
            url: 'git@github.com:user/test.git',
            path: '/home/user/code/test',
          },
        ],
      } satisfies ReposConfig;
      await Bun.write(testConfigPath, JSON.stringify(config, null, 2));

      expect(await readConfig(testConfigPath)).toEqual({
        success: true,
        data: config,
      });
    });

    test('reads config with legacy branch field (backwards compatible)', async () => {
      const legacyConfig = {
        repos: [
          {
            name: 'test',
            url: 'git@github.com:user/test.git',
            branch: 'main',
            path: '/home/user/code/test',
          },
        ],
      };
      await Bun.write(testConfigPath, JSON.stringify(legacyConfig, null, 2));

      const result = await readConfig(testConfigPath);
      expect(result).toEqual({
        success: true,
        data: {
          repos: [
            objectContaining({
              name: 'test',
              url: 'git@github.com:user/test.git',
              path: '/home/user/code/test',
            }),
          ],
        },
      });
    });

    test('reads config with bare repo', async () => {
      const config = {
        repos: [
          {
            name: 'test',
            url: 'git@github.com:user/test.git',
            path: '/home/user/code/test',
            bare: true,
          },
        ],
      } satisfies ReposConfig;
      await Bun.write(testConfigPath, JSON.stringify(config, null, 2));

      expect(await readConfig(testConfigPath)).toEqual({
        success: true,
        data: config,
      });
    });

    test('returns error for invalid JSON', async () => {
      await Bun.write(testConfigPath, 'not valid json');

      expect(await readConfig(testConfigPath)).toEqual({
        success: false,
        error: 'Failed to parse config file',
      });
    });
  });

  describe('writeConfig', () => {
    test('creates parent directories if they do not exist', async () => {
      const nestedPath = join(testDir, 'nested', 'deep', 'config.json');
      const config = {
        repos: [{ name: 'test', url: 'u', path: '/p/test' }],
      } satisfies ReposConfig;

      expect(await writeConfig(nestedPath, config)).toEqual({
        success: true,
        data: undefined,
      });

      expect(await readConfig(nestedPath)).toEqual({
        success: true,
        data: config,
      });
    });

    test('writes config to file', async () => {
      const config = {
        repos: [
          {
            name: 'test',
            url: 'git@github.com:user/test.git',
            path: '/home/user/code/test',
          },
        ],
      } satisfies ReposConfig;

      expect(await writeConfig(testConfigPath, config)).toEqual({
        success: true,
        data: undefined,
      });

      expect(await readConfig(testConfigPath)).toEqual({
        success: true,
        data: config,
      });
    });

    test('overwrites existing config', async () => {
      const config1 = {
        repos: [{ name: 'old', url: 'u', path: '/p/old' }],
      } satisfies ReposConfig;
      const config2 = {
        repos: [{ name: 'new', url: 'u', path: '/p/new' }],
      } satisfies ReposConfig;

      await writeConfig(testConfigPath, config1);
      await writeConfig(testConfigPath, config2);

      expect(await readConfig(testConfigPath)).toEqual({
        success: true,
        data: config2,
      });
    });
  });
});
