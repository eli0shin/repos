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
    branch: 'main',
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
        branch: 'develop',
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

  describe('updateRepoBranch', () => {
    test('updates branch for existing repo', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      expect(updateRepoBranch(configWithRepo, 'test-repo', 'develop')).toEqual({
        repos: [{ ...sampleRepo, branch: 'develop' }],
      });
    });

    test('returns unchanged config if repo not found', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      expect(
        updateRepoBranch(configWithRepo, 'nonexistent', 'develop')
      ).toEqual(configWithRepo);
    });

    test('does not mutate original config', () => {
      const configWithRepo = { repos: [sampleRepo] } satisfies ReposConfig;
      updateRepoBranch(configWithRepo, 'test-repo', 'develop');
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
          { name: 'test', url: 'git@github.com:user/test.git', branch: 'main' },
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
    test('writes config to file', async () => {
      const config = {
        repos: [
          { name: 'test', url: 'git@github.com:user/test.git', branch: 'main' },
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
        repos: [{ name: 'old', url: 'u', branch: 'b' }],
      } satisfies ReposConfig;
      const config2 = {
        repos: [{ name: 'new', url: 'u', branch: 'b' }],
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
