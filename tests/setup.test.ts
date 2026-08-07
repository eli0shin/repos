import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { HERDR_ENVIRONMENT_KEYS } from './utils.ts';

function normalizeTestOutput(output: string): string {
  return output
    .replace(/repos-test-workspace-manager-\d+/g, '<repo>')
    .replace(/\[\d+(?:\.\d+)?(?:ms|s)\]/g, '[<time>]');
}

test('test setup isolates the tmux suite from inherited Herdr markers', async () => {
  const herdrEnvironment = Object.fromEntries(
    HERDR_ENVIRONMENT_KEYS.map((key) => [
      key,
      key === 'HERDR_ENV'
        ? '1'
        : key === 'HERDR_BIN_PATH'
          ? '/definitely/missing/herdr'
          : `${key}-inherited`,
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

  expect({
    stdout: normalizeTestOutput(stdout),
    stderr: normalizeTestOutput(stderr),
    exitCode,
  }).toEqual({
    stdout:
      `bun test v${Bun.version} (${Bun.revision.slice(0, 8)})\n` +
      'Killed tmux session "<repo>@feature"\n' +
      'Killed tmux session "<repo>@feature"\n' +
      'Killed tmux session "<repo>@feature"\n' +
      'Killed tmux session "<repo>@feature"\n' +
      'Killed tmux session "<repo>@other"\n' +
      'Killed tmux session "<repo>@feature"\n',
    stderr:
      '\ntests/workspace-manager.test.ts:\n' +
      'Created tmux session "<repo>@feature"\n' +
      '(pass) Workspace Manager > opens and reuses a Managed Workspace while preserving focus [<time>]\n' +
      'Created tmux session "<repo>@feature"\n' +
      '(pass) Workspace Manager > previews and executes a captured closure after its worktree is removed [<time>]\n' +
      'Created tmux session "<repo>@feature"\n' +
      'Created tmux session "<repo>@other"\n' +
      '(pass) Workspace Manager > executes an automatic batch closure from one captured plan [<time>]\n' +
      'Created tmux session "<repo>@feature"\n' +
      'Created tmux session "<repo>@main"\n' +
      '(pass) Workspace Manager > selects a candidate before active automatic closure [<time>]\n' +
      'Created tmux session "<repo>@feature"\n' +
      'Created tmux session "<repo>@main"\n' +
      '(pass) Workspace Manager > rechecks focus before active automatic closure [<time>]\n' +
      'Created tmux session "<repo>@feature"\n' +
      'Warning: cannot identify current tmux session — no tmux sessions were killed: cannot recheck current session\n' +
      '(pass) Workspace Manager > does not close workspaces when focus cannot be rechecked [<time>]\n' +
      'Created tmux session "<repo>@feature"\n' +
      'Created tmux session "<repo>@main"\n' +
      '(pass) Workspace Manager > uses a validated safe last session before automatic closure [<time>]\n' +
      'Created tmux session "<repo>@feature"\n' +
      'Created tmux session "<repo>@other"\n' +
      '(pass) Workspace Manager > creates a fresh session when the last session is also closing [<time>]\n' +
      'Created tmux session "<repo>@feature"\n' +
      '(pass) Workspace Manager > does not close a replacement session that reuses a planned name [<time>]\n' +
      'Created tmux session "<repo>@feature"\n' +
      '(pass) Workspace Manager > does not close a fresh session that reuses a planned name [<time>]\n' +
      'Created tmux session "<repo>@feature"\n' +
      '(pass) Workspace Manager > moves focus to a destination before closing the active workspace [<time>]\n' +
      '\n 11 pass\n' +
      ' 0 fail\n' +
      ' 34 expect() calls\n' +
      'Ran 11 tests across 1 file. [<time>]\n',
    exitCode: 0,
  });
}, 15_000);
