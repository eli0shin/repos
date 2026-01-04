import { describe, expect, test, afterEach } from 'bun:test';
import { rm } from 'node:fs/promises';
import { handleAutoUpdate } from '../src/auto-update.ts';
import { writeUpdateState } from '../src/update-state.ts';

describe('handleAutoUpdate', () => {
  const testStatePath = '/tmp/repos-test-auto-update-state';
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  afterEach(async () => {
    await rm(testStatePath, { force: true });
  });

  test('returns no message when state is empty and behavior is auto', async () => {
    const result = await handleAutoUpdate('1.0.0', 'auto', 24, testStatePath);
    expect(result).toEqual({ message: undefined });
  });

  test('returns no message when state is empty and behavior is off', async () => {
    const result = await handleAutoUpdate('1.0.0', 'off', 24, testStatePath);
    expect(result).toEqual({ message: undefined });
  });

  test('returns pending notification message for notify mode', async () => {
    await writeUpdateState(testStatePath, {
      lastCheckedAt: Date.now(),
      pendingNotification: '2.0.0',
    });

    const result = await handleAutoUpdate('1.0.0', 'notify', 24, testStatePath);
    expect(result).toEqual({ message: 'Update available: v2.0.0' });
  });

  test('does not return pending notification for auto mode', async () => {
    await writeUpdateState(testStatePath, {
      lastCheckedAt: Date.now(),
      pendingNotification: '2.0.0',
    });

    const result = await handleAutoUpdate('1.0.0', 'auto', 24, testStatePath);
    expect(result).toEqual({ message: undefined });
  });

  test('does not spawn when behavior is off', async () => {
    const spawned: string[][] = [];
    const mockSpawn = (args: string[]) => {
      spawned.push(args);
    };

    await handleAutoUpdate('1.0.0', 'off', 24, testStatePath, mockSpawn);
    expect(spawned.length).toBe(0);
  });

  test('does not spawn when within cooldown', async () => {
    await writeUpdateState(testStatePath, {
      lastCheckedAt: Date.now() - 1000, // 1 second ago
    });

    const spawned: string[][] = [];
    const mockSpawn = (args: string[]) => {
      spawned.push(args);
    };

    await handleAutoUpdate('1.0.0', 'auto', 24, testStatePath, mockSpawn);
    expect(spawned.length).toBe(0);
  });

  test('spawns updater when cooldown expired', async () => {
    await writeUpdateState(testStatePath, {
      lastCheckedAt: Date.now() - ONE_DAY_MS - 1000, // expired
    });

    const spawned: string[][] = [];
    const mockSpawn = (args: string[]) => {
      spawned.push(args);
    };

    await handleAutoUpdate('1.0.0', 'auto', 24, testStatePath, mockSpawn);
    expect(spawned.length).toBe(1);
    expect(spawned[0]).toContain('--update-worker');
    expect(spawned[0]).toContain('1.0.0');
    expect(spawned[0]).toContain('auto');
  });

  test('spawns updater when no state exists', async () => {
    const spawned: string[][] = [];
    const mockSpawn = (args: string[]) => {
      spawned.push(args);
    };

    await handleAutoUpdate('1.0.0', 'notify', 24, testStatePath, mockSpawn);
    expect(spawned.length).toBe(1);
    expect(spawned[0]).toContain('notify');
  });

  test('respects custom check interval', async () => {
    await writeUpdateState(testStatePath, {
      lastCheckedAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
    });

    const spawned: string[][] = [];
    const mockSpawn = (args: string[]) => {
      spawned.push(args);
    };

    // With 1 hour interval, should spawn (2h > 1h)
    await handleAutoUpdate('1.0.0', 'auto', 1, testStatePath, mockSpawn);
    expect(spawned.length).toBe(1);
  });

  test('does not spawn when within custom check interval', async () => {
    await writeUpdateState(testStatePath, {
      lastCheckedAt: Date.now() - 30 * 60 * 1000, // 30 minutes ago
    });

    const spawned: string[][] = [];
    const mockSpawn = (args: string[]) => {
      spawned.push(args);
    };

    // With 1 hour interval, should not spawn (30m < 1h)
    await handleAutoUpdate('1.0.0', 'auto', 1, testStatePath, mockSpawn);
    expect(spawned.length).toBe(0);
  });
});
