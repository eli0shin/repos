import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { sessionCommand } from '../src/commands/session.ts';
import { writeConfig } from '../src/config.ts';
import { mockProcessExit } from './utils.ts';

describe('sessionCommand', () => {
  const configPath = '/tmp/repos-test-session-cmd/config.json';

  beforeEach(async () => {
    await mkdir('/tmp/repos-test-session-cmd', { recursive: true });
  });

  afterEach(async () => {
    await rm('/tmp/repos-test-session-cmd', { recursive: true, force: true });
  });

  test('exits with error when named repo is not found in config', async () => {
    await writeConfig(configPath, { repos: [] });

    const mockExit = mockProcessExit();
    try {
      await sessionCommand({ configPath }, 'feature', 'nonexistent-repo');
    } catch {
      // mockProcessExit throws to simulate process.exit
    } finally {
      mockExit.mockRestore();
    }

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('exits with error when not inside a tracked repo and no repo name given', async () => {
    await writeConfig(configPath, { repos: [] });

    const mockExit = mockProcessExit();
    // Run from a directory that is not a tracked repo
    const originalCwd = process.cwd();
    try {
      process.chdir('/tmp');
      await sessionCommand({ configPath }, 'feature');
    } catch {
      // mockProcessExit throws to simulate process.exit
    } finally {
      process.chdir(originalCwd);
      mockExit.mockRestore();
    }

    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
