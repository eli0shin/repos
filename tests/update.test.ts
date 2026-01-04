import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { arch, platform } from 'node:os';
import {
  getBinaryName,
  isPrerelease,
  isNewerVersion,
  fetchLatestVersion,
  replaceBinary,
} from '../src/update.ts';

describe('isPrerelease', () => {
  test('returns false for stable version', () => {
    expect(isPrerelease('1.0.0')).toBe(false);
  });

  test('returns true for beta version', () => {
    expect(isPrerelease('1.0.0-beta.1')).toBe(true);
  });

  test('returns true for alpha version', () => {
    expect(isPrerelease('2.0.0-alpha')).toBe(true);
  });

  test('returns true for rc version', () => {
    expect(isPrerelease('1.2.3-rc.2')).toBe(true);
  });
});

describe('getBinaryName', () => {
  test('returns repos-darwin-x64 for darwin x64', () => {
    expect(getBinaryName('darwin', 'x64')).toBe('repos-darwin-x64');
  });

  test('returns repos-darwin-arm64 for darwin arm64', () => {
    expect(getBinaryName('darwin', 'arm64')).toBe('repos-darwin-arm64');
  });

  test('returns repos-linux-x64 for linux x64', () => {
    expect(getBinaryName('linux', 'x64')).toBe('repos-linux-x64');
  });

  test('returns repos-linux-arm64 for linux arm64', () => {
    expect(getBinaryName('linux', 'arm64')).toBe('repos-linux-arm64');
  });
});

describe('isNewerVersion', () => {
  test('returns true when latest major is higher', () => {
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true);
  });

  test('returns true when latest minor is higher', () => {
    expect(isNewerVersion('1.0.0', '1.1.0')).toBe(true);
  });

  test('returns true when latest patch is higher', () => {
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(true);
  });

  test('returns false when versions are equal', () => {
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
  });

  test('returns false when current major is higher', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false);
  });

  test('returns false when current minor is higher', () => {
    expect(isNewerVersion('1.2.0', '1.1.9')).toBe(false);
  });

  test('returns false when current patch is higher', () => {
    expect(isNewerVersion('1.0.2', '1.0.1')).toBe(false);
  });
});

describe('fetchLatestVersion', () => {
  const originalFetch = globalThis.fetch;

  function createMockFetch(response: Response) {
    const mockFn = mock(() => Promise.resolve(response));
    return Object.assign(mockFn, { preconnect: originalFetch.preconnect });
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns version and download URL on success', async () => {
    globalThis.fetch = createMockFetch(
      new Response(JSON.stringify({ tag_name: 'v1.2.3' }), { status: 200 })
    );

    const currentPlatform = platform() === 'darwin' ? 'darwin' : 'linux';
    const currentArch = arch() === 'arm64' ? 'arm64' : 'x64';
    const expectedBinary = `repos-${currentPlatform}-${currentArch}`;

    expect(await fetchLatestVersion()).toEqual({
      success: true,
      data: {
        version: '1.2.3',
        downloadUrl: `https://github.com/eli0shin/repos/releases/latest/download/${expectedBinary}`,
      },
    });
  });

  test('strips v prefix from version', async () => {
    globalThis.fetch = createMockFetch(
      new Response(JSON.stringify({ tag_name: 'v2.0.0' }), { status: 200 })
    );

    const currentPlatform = platform() === 'darwin' ? 'darwin' : 'linux';
    const currentArch = arch() === 'arm64' ? 'arm64' : 'x64';
    const expectedBinary = `repos-${currentPlatform}-${currentArch}`;

    expect(await fetchLatestVersion()).toEqual({
      success: true,
      data: {
        version: '2.0.0',
        downloadUrl: `https://github.com/eli0shin/repos/releases/latest/download/${expectedBinary}`,
      },
    });
  });

  test('returns error on 404', async () => {
    globalThis.fetch = createMockFetch(new Response('', { status: 404 }));

    expect(await fetchLatestVersion()).toEqual({
      success: false,
      error: 'No releases found',
    });
  });

  test('returns error on other HTTP errors', async () => {
    globalThis.fetch = createMockFetch(new Response('', { status: 500 }));

    expect(await fetchLatestVersion()).toEqual({
      success: false,
      error: 'GitHub API error: 500',
    });
  });
});

describe('replaceBinary', () => {
  const testDir = '/tmp/repos-update-test';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('replaces target file with source file', async () => {
    const sourcePath = join(testDir, 'source');
    const targetPath = join(testDir, 'target');

    await Bun.write(sourcePath, 'new content');
    await Bun.write(targetPath, 'old content');

    const result = await replaceBinary(sourcePath, targetPath);

    expect(result).toEqual({ success: true, data: undefined });
    expect(await Bun.file(targetPath).text()).toBe('new content');
  });

  test('creates target if it does not exist', async () => {
    const sourcePath = join(testDir, 'source');
    const targetPath = join(testDir, 'newtarget');

    await Bun.write(sourcePath, 'new binary');

    const result = await replaceBinary(sourcePath, targetPath);

    expect(result).toEqual({ success: true, data: undefined });
    expect(await Bun.file(targetPath).text()).toBe('new binary');
  });
});
