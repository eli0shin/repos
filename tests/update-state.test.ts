import { describe, expect, test, afterEach } from 'bun:test';
import { rm } from 'node:fs/promises';
import {
  readUpdateState,
  writeUpdateState,
  shouldCheckForUpdate,
  getUpdateStatePath,
} from '../src/update-state.ts';

describe('getUpdateStatePath', () => {
  test('returns path in home directory', () => {
    const path = getUpdateStatePath();
    expect(path).toMatch(/\.repos-update-state$/);
  });
});

describe('readUpdateState', () => {
  const testStatePath = '/tmp/repos-test-update-state';

  afterEach(async () => {
    await rm(testStatePath, { force: true });
  });

  test('returns null when file does not exist', async () => {
    const result = await readUpdateState(testStatePath);
    expect(result).toEqual({ success: true, data: null });
  });

  test('returns state when file exists with valid JSON', async () => {
    const state = { lastCheckedAt: 1704326400000 };
    await Bun.write(testStatePath, JSON.stringify(state));

    const result = await readUpdateState(testStatePath);
    expect(result).toEqual({ success: true, data: state });
  });

  test('returns state with pendingNotification', async () => {
    const state = {
      lastCheckedAt: 1704326400000,
      pendingNotification: '1.2.3',
    };
    await Bun.write(testStatePath, JSON.stringify(state));

    const result = await readUpdateState(testStatePath);
    expect(result).toEqual({ success: true, data: state });
  });

  test('returns null for invalid JSON', async () => {
    await Bun.write(testStatePath, 'not valid json');

    const result = await readUpdateState(testStatePath);
    expect(result).toEqual({ success: true, data: null });
  });

  test('returns null for malformed state (missing lastCheckedAt)', async () => {
    await Bun.write(testStatePath, JSON.stringify({ foo: 'bar' }));

    const result = await readUpdateState(testStatePath);
    expect(result).toEqual({ success: true, data: null });
  });
});

describe('writeUpdateState', () => {
  const testStatePath = '/tmp/repos-test-update-state';

  afterEach(async () => {
    await rm(testStatePath, { force: true });
  });

  test('writes state to file', async () => {
    const state = { lastCheckedAt: 1704326400000 };

    const result = await writeUpdateState(testStatePath, state);

    expect(result).toEqual({ success: true, data: undefined });
    const text = await Bun.file(testStatePath).text();
    expect(JSON.parse(text)).toEqual(state);
  });

  test('writes state with pendingNotification', async () => {
    const state = {
      lastCheckedAt: 1704326400000,
      pendingNotification: '2.0.0',
    };

    const result = await writeUpdateState(testStatePath, state);

    expect(result).toEqual({ success: true, data: undefined });
    const text = await Bun.file(testStatePath).text();
    expect(JSON.parse(text)).toEqual(state);
  });

  test('overwrites existing state', async () => {
    await Bun.write(testStatePath, JSON.stringify({ lastCheckedAt: 1000 }));
    const newState = { lastCheckedAt: 2000 };

    const result = await writeUpdateState(testStatePath, newState);

    expect(result).toEqual({ success: true, data: undefined });
    const text = await Bun.file(testStatePath).text();
    expect(JSON.parse(text)).toEqual(newState);
  });
});

describe('shouldCheckForUpdate', () => {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  test('returns true when state is null', () => {
    expect(shouldCheckForUpdate(null)).toBe(true);
  });

  test('returns true when cooldown has expired', () => {
    const oldTimestamp = Date.now() - ONE_DAY_MS - 1000;
    expect(shouldCheckForUpdate({ lastCheckedAt: oldTimestamp })).toBe(true);
  });

  test('returns false when within cooldown period', () => {
    const recentTimestamp = Date.now() - ONE_DAY_MS + 60000; // 1 minute before cooldown expires
    expect(shouldCheckForUpdate({ lastCheckedAt: recentTimestamp })).toBe(
      false
    );
  });

  test('returns false when just checked', () => {
    const now = Date.now();
    expect(shouldCheckForUpdate({ lastCheckedAt: now })).toBe(false);
  });
});
