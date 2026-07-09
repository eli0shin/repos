import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { chmod, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getPullRequestStatus } from '../src/github.ts';

describe('getPullRequestStatus', () => {
  const testDir = '/tmp/repos-test-github';
  const binDir = join(testDir, 'bin');
  const worktreePath = join(testDir, 'worktree');
  const recordPath = join(testDir, 'record.json');
  let originalPath: string | undefined;
  let originalGhStdout: string | undefined;
  let originalGhExit: string | undefined;
  let originalGhSleepMs: string | undefined;
  let originalRecordPath: string | undefined;

  beforeEach(async () => {
    originalPath = process.env.PATH;
    originalGhStdout = process.env.GH_STDOUT;
    originalGhExit = process.env.GH_EXIT;
    originalGhSleepMs = process.env.GH_SLEEP_MS;
    originalRecordPath = process.env.RECORD_PATH;

    await mkdir(binDir, { recursive: true });
    await mkdir(worktreePath, { recursive: true });
    await Bun.write(
      join(binDir, 'gh'),
      [
        '#!/usr/bin/env bun',
        'const recordPath = process.env.RECORD_PATH;',
        'if (recordPath) {',
        '  await Bun.write(recordPath, JSON.stringify({ args: Bun.argv.slice(2), cwd: process.cwd() }));',
        '}',
        'if (process.env.GH_EXIT) {',
        '  process.stderr.write("gh failed");',
        '  process.exit(Number(process.env.GH_EXIT));',
        '}',
        'if (process.env.GH_SLEEP_MS) {',
        '  await new Promise((resolve) => setTimeout(resolve, Number(process.env.GH_SLEEP_MS)));',
        '}',
        'process.stdout.write(process.env.GH_STDOUT ?? "[]");',
      ].join('\n')
    );
    await chmod(join(binDir, 'gh'), 0o755);

    process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;
    process.env.RECORD_PATH = recordPath;
    delete process.env.GH_EXIT;
    delete process.env.GH_SLEEP_MS;
    delete process.env.GH_STDOUT;
  });

  afterEach(async () => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalGhStdout === undefined) delete process.env.GH_STDOUT;
    else process.env.GH_STDOUT = originalGhStdout;
    if (originalGhExit === undefined) delete process.env.GH_EXIT;
    else process.env.GH_EXIT = originalGhExit;
    if (originalGhSleepMs === undefined) delete process.env.GH_SLEEP_MS;
    else process.env.GH_SLEEP_MS = originalGhSleepMs;
    if (originalRecordPath === undefined) delete process.env.RECORD_PATH;
    else process.env.RECORD_PATH = originalRecordPath;
    await rm(testDir, { recursive: true, force: true });
  });

  test('returns no status when gh finds no PR and invokes gh from the worktree', async () => {
    process.env.GH_STDOUT = '[]';

    const result = await getPullRequestStatus(worktreePath, 'feature');

    expect(result).toBeUndefined();
    const record = JSON.parse(await readFile(recordPath, 'utf8'));
    expect(record).toEqual({
      args: [
        'pr',
        'list',
        '--head',
        'feature',
        '--state',
        'all',
        '--limit',
        '1',
        '--json',
        'state,mergedAt,url',
      ],
      cwd: worktreePath,
    });
  });

  test('maps gh PR states to list labels', async () => {
    process.env.GH_STDOUT = '[{"state":"OPEN","mergedAt":null}]';
    expect(await getPullRequestStatus(worktreePath, 'open')).toEqual({
      status: 'open',
    });

    process.env.GH_STDOUT = '[{"state":"MERGED","mergedAt":null}]';
    expect(await getPullRequestStatus(worktreePath, 'merged')).toEqual({
      status: 'merged',
    });

    process.env.GH_STDOUT =
      '[{"state":"CLOSED","mergedAt":"2026-01-01T00:00:00Z"}]';
    expect(
      await getPullRequestStatus(worktreePath, 'closed-with-merge-date')
    ).toEqual({ status: 'merged' });

    process.env.GH_STDOUT = '[{"state":"CLOSED","mergedAt":null}]';
    expect(await getPullRequestStatus(worktreePath, 'closed')).toEqual({
      status: 'closed',
    });
  });

  test('returns PR status with URL when gh provides one', async () => {
    process.env.GH_STDOUT =
      '[{"state":"OPEN","mergedAt":null,"url":"https://github.com/example/repo/pull/1"}]';

    expect(await getPullRequestStatus(worktreePath, 'feature')).toEqual({
      status: 'open',
      url: 'https://github.com/example/repo/pull/1',
    });
  });

  test('returns unknown for gh errors and malformed output', async () => {
    process.env.GH_EXIT = '1';
    expect(await getPullRequestStatus(worktreePath, 'feature')).toEqual({
      status: 'unknown',
    });

    delete process.env.GH_EXIT;
    process.env.GH_STDOUT = 'not json';
    expect(await getPullRequestStatus(worktreePath, 'feature')).toEqual({
      status: 'unknown',
    });
  });

  test('returns unknown when gh times out', async () => {
    process.env.GH_SLEEP_MS = '1000';
    process.env.GH_STDOUT = '[{"state":"OPEN","mergedAt":null}]';

    const result = await getPullRequestStatus(worktreePath, 'feature', {
      timeoutMs: 10,
    });

    expect(result).toEqual({ status: 'unknown' });
  });
});
