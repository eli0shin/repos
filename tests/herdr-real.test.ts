import { expect, test } from 'bun:test';
import { join } from 'node:path';

const herdrBinary = Bun.which('herdr');
const integrationTest = herdrBinary ? test : test.skip;

function normalizeTestOutput(output: string): string {
  return output.replace(/\[\d+(?:\.\d+)?(?:ms|s)\]/g, '[<time>]');
}

integrationTest(
  'real Herdr scenarios run in an isolated child process',
  async () => {
    const childEnvironment = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => key !== 'GITHUB_ACTIONS' && key !== 'FORCE_COLOR'
        )
      ),
      NO_COLOR: '1',
    };
    const proc = Bun.spawn(
      [process.execPath, 'test', './tests/fixtures/herdr-real.fixture.ts'],
      {
        cwd: join(import.meta.dir, '..'),
        env: childEnvironment,
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
        'Closed Herdr workspace "repo@feature-real"\n',
      stderr:
        '\ntests/fixtures/herdr-real.fixture.ts:\n' +
        'Opened Herdr workspace "repo@feature-real"\n' +
        '(pass) real Herdr integration > uses one isolated-session workspace through open, reuse, and planned closure [<time>]\n' +
        'Opened Herdr workspace "bare@main~0d6e4079e367"\n' +
        '(pass) real Herdr integration > verifies bare workspace provenance before reuse and closure [<time>]\n' +
        'Opened Herdr workspace "bare@main"\n' +
        'Attaching to existing Herdr workspace "bare@main"\n' +
        '(pass) real Herdr integration > replaces a closing default-branch workspace with the bare destination [<time>]\n' +
        '\n 3 pass\n' +
        ' 0 fail\n' +
        ' 7 expect() calls\n' +
        'Ran 3 tests across 1 file. [<time>]\n',
      exitCode: 0,
    });
  },
  60_000
);
