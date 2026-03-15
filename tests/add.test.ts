import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { runGitCommand, isGitRepo, isBareRepo } from '../src/git.ts';
import { addCommand } from '../src/commands/add.ts';
import { readConfig, writeConfig } from '../src/config.ts';
import { mockProcessExit, type MockExit } from './utils.ts';

// Helper to create a test repo with commits
async function createTestRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await runGitCommand(['init'], dir);
  await runGitCommand(['config', 'user.email', 'test@test.com'], dir);
  await runGitCommand(['config', 'user.name', 'Test'], dir);
  await Bun.write(join(dir, 'test.txt'), 'test');
  await runGitCommand(['add', '.'], dir);
  await runGitCommand(['commit', '-m', 'initial'], dir);
}

describe('repos add command', () => {
  const testDir = '/tmp/repos-test-add-cmd';
  const sourceDir = '/tmp/repos-test-add-cmd-source';
  const configPath = '/tmp/repos-test-add-cmd-config/config.json';
  let mockExit: MockExit;
  let originalCwd: string;

  beforeEach(async () => {
    mockExit = mockProcessExit();
    originalCwd = process.cwd();
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
    await writeConfig(configPath, { repos: [] });
    process.chdir(testDir);
  });

  afterEach(async () => {
    mockExit.mockRestore();
    process.chdir(originalCwd);
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-add-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('clones and tracks a regular repo', async () => {
    await addCommand({ configPath }, sourceDir);

    // process.cwd() resolves /tmp to /private/tmp on macOS
    const realTestDir = realpathSync(testDir);
    const repoDir = join(realTestDir, 'repos-test-add-cmd-source');
    expect(await isGitRepo(repoDir)).toBe(true);

    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'repos-test-add-cmd-source',
            url: sourceDir,
            path: repoDir,
          },
        ],
      },
    });
  });

  test('clones and tracks a bare repo', async () => {
    await addCommand({ configPath }, sourceDir, { bare: true });

    const realTestDir = realpathSync(testDir);
    const repoDir = join(realTestDir, 'repos-test-add-cmd-source');
    expect(await isBareRepo(repoDir)).toBe(true);

    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'repos-test-add-cmd-source',
            url: sourceDir,
            path: repoDir,
            bare: true,
          },
        ],
      },
    });
  });

  test('fails when repo is already tracked', async () => {
    // Add it first
    await addCommand({ configPath }, sourceDir);

    // Try adding the same URL again — name will be the same, so it should fail
    // Need to remove the directory first so the clone check doesn't trigger
    const realTestDir = realpathSync(testDir);
    const repoDir = join(realTestDir, 'repos-test-add-cmd-source');
    await rm(repoDir, { recursive: true, force: true });

    await expect(addCommand({ configPath }, sourceDir)).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
