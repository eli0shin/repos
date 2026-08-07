import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { anyString, matchString } from './helpers.ts';
import { HERDR_ENVIRONMENT_KEYS } from './utils.ts';

test('test setup isolates the tmux suite from inherited Herdr markers', async () => {
  const herdrEnvironment = Object.fromEntries(
    HERDR_ENVIRONMENT_KEYS.map((key) => [
      key,
      key === 'HERDR_ENV' ? '1' : `${key}-inherited`,
    ])
  );
  const proc = Bun.spawn(
    [
      process.execPath,
      'test',
      join(import.meta.dir, 'workspace-manager.test.ts'),
    ],
    {
      cwd: import.meta.dir.replace('/tests', ''),
      env: { ...process.env, ...herdrEnvironment },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: anyString(),
    stderr: matchString(/\n 11 pass\n 0 fail\n 34 expect\(\) calls\n/),
    exitCode: 0,
  });
}, 15_000);
