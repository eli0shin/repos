import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { access, mkdir, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { runGitCommand, isGitRepo, cloneBare } from '../src/git/index.ts';
import { removeCommand } from '../src/commands/remove.ts';
import { readConfig, writeConfig } from '../src/config.ts';
import type { ReposConfig } from '../src/types.ts';
import { createTestRepo } from './helpers.ts';
import { mockProcessExit, type MockExit } from './utils.ts';

async function directoryExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('repos remove command', () => {
  const testDir = '/tmp/repos-test-remove-cmd';
  const sourceDir = '/tmp/repos-test-remove-cmd-source';
  const configPath = '/tmp/repos-test-remove-cmd-config/config.json';
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
    await rm('/tmp/repos-test-remove-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('removes repo from config without deleting directory', async () => {
    const repoDir = join(testDir, 'repo');
    await runGitCommand(['clone', sourceDir, repoDir]);

    const config = {
      repos: [{ name: 'repo', url: sourceDir, path: repoDir }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    await removeCommand({ configPath }, 'repo', false);

    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: { repos: [] },
    });

    // Directory should still exist
    expect(await isGitRepo(repoDir)).toBe(true);
  });

  test('removes repo from config and deletes directory', async () => {
    const repoDir = join(testDir, 'repo');
    await runGitCommand(['clone', sourceDir, repoDir]);
    const realRepoDir = realpathSync(repoDir);

    const config = {
      repos: [{ name: 'repo', url: sourceDir, path: realRepoDir }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    await removeCommand({ configPath }, 'repo', true);

    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: { repos: [] },
    });

    // Directory should be gone
    expect(await directoryExists(realRepoDir)).toBe(false);
  });

  test('deletes bare repo directory with --delete', async () => {
    const bareDir = join(testDir, 'project.git');
    await cloneBare(sourceDir, bareDir);
    const realBareDir = realpathSync(bareDir);

    const config = {
      repos: [
        {
          name: 'project',
          url: sourceDir,
          path: realBareDir,
          bare: true,
        },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    await removeCommand({ configPath }, 'project', true);

    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: { repos: [] },
    });

    // Bare repo directory should be gone
    expect(await directoryExists(realBareDir)).toBe(false);
  });

  test('cleans up worktrees before deleting bare repo', async () => {
    const bareDir = join(testDir, 'project.git');
    await cloneBare(sourceDir, bareDir);

    // Create a worktree
    const worktreePath = join(testDir, 'project.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    expect(await isGitRepo(worktreePath)).toBe(true);

    const realBareDir = realpathSync(bareDir);
    const realWorktreePath = realpathSync(worktreePath);

    const config = {
      repos: [
        {
          name: 'project',
          url: sourceDir,
          path: realBareDir,
          bare: true,
        },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    await removeCommand({ configPath }, 'project', true);

    // Both bare repo and worktree should be gone
    expect(await directoryExists(realBareDir)).toBe(false);
    expect(await directoryExists(realWorktreePath)).toBe(false);
  });

  test('fails for unknown repo name', async () => {
    await writeConfig(configPath, {
      repos: [{ name: 'repo', url: sourceDir, path: '/tmp/whatever' }],
    });

    await expect(
      removeCommand({ configPath }, 'nonexistent', false)
    ).rejects.toThrow('process.exit(1)');
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
