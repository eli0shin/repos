import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runGitCommand, isGitRepo, isBareRepo } from '../src/git/index.ts';
import { cloneCommand } from '../src/commands/clone.ts';
import { writeConfig } from '../src/config.ts';
import type { ReposConfig } from '../src/types.ts';
import { createTestRepo } from './helpers.ts';
import { mockProcessExit, type MockExit } from './utils.ts';

describe('repos clone command', () => {
  const testDir = '/tmp/repos-test-clone-cmd';
  const sourceDir = '/tmp/repos-test-clone-cmd-source';
  const configPath = '/tmp/repos-test-clone-cmd-config/config.json';
  let mockExit: MockExit;

  beforeEach(async () => {
    mockExit = mockProcessExit();
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
    mockExit.mockRestore();
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-clone-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('clones a regular repo from config', async () => {
    const repoDir = join(testDir, 'repo');

    const config = {
      repos: [{ name: 'repo', url: sourceDir, path: repoDir }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    await cloneCommand({ configPath }, 'repo');

    expect(await isGitRepo(repoDir)).toBe(true);
  });

  test('clones a bare repo from config', async () => {
    const bareDir = join(testDir, 'project.git');

    const config = {
      repos: [{ name: 'project', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    await cloneCommand({ configPath }, 'project');

    expect(await isBareRepo(bareDir)).toBe(true);
  });

  test('skips already existing repo', async () => {
    const repoDir = join(testDir, 'repo');
    await runGitCommand(['clone', sourceDir, repoDir]);

    const config = {
      repos: [{ name: 'repo', url: sourceDir, path: repoDir }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Should not error, just skip
    await cloneCommand({ configPath }, 'repo');

    expect(await isGitRepo(repoDir)).toBe(true);
  });

  test('exits with error for unknown repo name', async () => {
    await writeConfig(configPath, {
      repos: [{ name: 'repo', url: sourceDir, path: '/tmp/whatever' }],
    });

    await expect(cloneCommand({ configPath }, 'nonexistent')).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('clones all missing repos', async () => {
    const repoDir1 = join(testDir, 'repo1');
    const repoDir2 = join(testDir, 'repo2');

    // Pre-clone repo1 so only repo2 is missing
    await runGitCommand(['clone', sourceDir, repoDir1]);

    const config = {
      repos: [
        { name: 'repo1', url: sourceDir, path: repoDir1 },
        { name: 'repo2', url: sourceDir, path: repoDir2 },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    await cloneCommand({ configPath });

    expect(await isGitRepo(repoDir1)).toBe(true);
    expect(await isGitRepo(repoDir2)).toBe(true);
  });
});
