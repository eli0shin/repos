import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { sessionCommand } from '../src/commands/session.ts';
import { writeConfig } from '../src/config.ts';
import { mockProcessExit, type MockExit } from './utils.ts';

describe('sessionCommand', () => {
  const configPath = '/tmp/repos-test-session-cmd/config.json';
  let mockExit: MockExit;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    mockExit = mockProcessExit();
    await mkdir('/tmp/repos-test-session-cmd', { recursive: true });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    mockExit.mockRestore();
    await rm('/tmp/repos-test-session-cmd', { recursive: true, force: true });
  });

  test('exits with error when named repo is not found in config', async () => {
    await writeConfig(configPath, { repos: [] });

    await expect(
      sessionCommand({ configPath }, 'feature', 'nonexistent-repo')
    ).rejects.toThrow('process.exit(1)');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('exits with error when not inside a tracked repo and no repo name given', async () => {
    await writeConfig(configPath, { repos: [] });

    process.chdir('/tmp');
    await expect(
      sessionCommand({ configPath }, 'feature')
    ).rejects.toThrow('process.exit(1)');
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
