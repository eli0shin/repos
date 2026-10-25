import { afterEach, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { createFakeHerdr } from './fake-herdr.ts';

const testDir = `/tmp/repos-test-fake-herdr-${process.pid}`;

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

test('overlapping fake Herdr commands never read partially written state', async () => {
  const fake = await createFakeHerdr(testDir, {
    calls: [{ args: ['x'.repeat(1024 * 1024)], environment: {} }],
  });
  const results = await Promise.all(
    Array.from({ length: 16 }, async () => {
      const proc = Bun.spawn([fake.binary, 'workspace', 'list'], {
        env: { ...process.env, FAKE_HERDR_STATE: fake.statePath },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, exitCode };
    })
  );
  expect(results).toEqual(
    Array.from({ length: 16 }, () => ({
      stdout:
        '{"id":"fake","result":{"type":"workspace_list","workspaces":[]}}\n',
      stderr: '',
      exitCode: 0,
    }))
  );
});
