import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  readWorktreeConfig,
  getMainWorktreeResolution,
} from '../src/worktree-config.ts';

describe('readWorktreeConfig', () => {
  const testDir = '/tmp/repos-test-worktree-config';
  const configPath = join(testDir, '.repos', 'worktree.json');

  beforeEach(async () => {
    await mkdir(join(testDir, '.repos'), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('returns empty config if file does not exist', async () => {
    expect(await readWorktreeConfig(configPath)).toEqual({
      success: true,
      data: {},
    });
  });

  test('reads setup copy and command config', async () => {
    const config = {
      setup: {
        copy: ['.env', '.env.local'],
        command: 'npm install',
      },
    };
    await Bun.write(configPath, JSON.stringify(config, null, 2));

    expect(await readWorktreeConfig(configPath)).toEqual({
      success: true,
      data: config,
    });
  });

  test('returns error for invalid JSON', async () => {
    await Bun.write(configPath, 'not valid json');

    expect(await readWorktreeConfig(configPath)).toEqual({
      success: false,
      error: 'Failed to parse worktree config file',
    });
  });

  test('returns error for invalid copy shape', async () => {
    await Bun.write(
      configPath,
      JSON.stringify({ setup: { copy: '.env' } }, null, 2)
    );

    expect(await readWorktreeConfig(configPath)).toEqual({
      success: false,
      error: 'Invalid worktree config file format',
    });
  });

  test('returns error for invalid command shape', async () => {
    await Bun.write(
      configPath,
      JSON.stringify({ setup: { command: ['npm', 'install'] } }, null, 2)
    );

    expect(await readWorktreeConfig(configPath)).toEqual({
      success: false,
      error: 'Invalid worktree config file format',
    });
  });
});

describe('getMainWorktreeResolution', () => {
  test('uses the main worktree when present', () => {
    expect(
      getMainWorktreeResolution(
        [
          { path: '/tmp/repo', branch: 'main', isMain: true },
          { path: '/tmp/repo-feature', branch: 'feature', isMain: false },
        ],
        '/tmp/repo'
      )
    ).toEqual({
      mainWorktreePath: '/tmp/repo',
      usedFallback: false,
    });
  });

  test('falls back to repo path when no main worktree is present', () => {
    expect(
      getMainWorktreeResolution(
        [{ path: '/tmp/repo-feature', branch: 'feature', isMain: false }],
        '/tmp/repo'
      )
    ).toEqual({
      mainWorktreePath: '/tmp/repo',
      usedFallback: true,
    });
  });
});
