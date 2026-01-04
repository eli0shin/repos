import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('repos init', () => {
  const testHome = '/tmp/repos-test-init-home';
  const projectDir = join(import.meta.dir, '..');
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    await mkdir(testHome, { recursive: true });
    process.env.HOME = testHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(testHome, { recursive: true, force: true });
  });

  async function runInit(
    args: string[] = []
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(['bun', 'run', 'src/cli.ts', 'init', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: projectDir,
      env: { ...process.env, HOME: testHome, SHELL: '/bin/zsh' },
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    return { stdout, stderr, exitCode };
  }

  test('fresh init creates config block in zshrc', async () => {
    const result = await runInit();

    expect(result).toEqual({
      stdout: `Added repos init to ${testHome}/.zshrc\nRestart your shell or run: source ${testHome}/.zshrc\n`,
      stderr: '',
      exitCode: 0,
    });

    const zshrc = await readFile(join(testHome, '.zshrc'), 'utf-8');
    expect(zshrc).toBe(
      '\n# repos CLI work command\neval "$(repos init --print)"\n'
    );
  });

  test('re-running init without force prints already configured', async () => {
    // First init
    await runInit();

    // Second init should detect existing config
    const result = await runInit();

    expect(result).toEqual({
      stdout: `Already configured in ${testHome}/.zshrc\nRestart your shell or run: source ${testHome}/.zshrc\n`,
      stderr: '',
      exitCode: 0,
    });

    // Should still only have one block
    const zshrc = await readFile(join(testHome, '.zshrc'), 'utf-8');
    expect(zshrc).toBe(
      '\n# repos CLI work command\neval "$(repos init --print)"\n'
    );
  });

  test('--force updates existing configuration', async () => {
    // Create existing config with old content
    const oldContent = `# existing config
export PATH="/usr/bin:$PATH"

# repos CLI work command
eval "$(repos init --print)"
`;
    await writeFile(join(testHome, '.zshrc'), oldContent);

    // Run with force
    const result = await runInit(['--force']);

    expect(result).toEqual({
      stdout: `Updated repos init in ${testHome}/.zshrc\nRestart your shell or run: source ${testHome}/.zshrc\n`,
      stderr: '',
      exitCode: 0,
    });

    // Should have updated the block (old removed, new appended)
    const zshrc = await readFile(join(testHome, '.zshrc'), 'utf-8');
    expect(zshrc).toBe(`# existing config
export PATH="/usr/bin:$PATH"
\n# repos CLI work command\neval "$(repos init --print)"\n`);
  });

  test('--force on fresh config behaves like regular init', async () => {
    const result = await runInit(['--force']);

    expect(result).toEqual({
      stdout: `Added repos init to ${testHome}/.zshrc\nRestart your shell or run: source ${testHome}/.zshrc\n`,
      stderr: '',
      exitCode: 0,
    });

    const zshrc = await readFile(join(testHome, '.zshrc'), 'utf-8');
    expect(zshrc).toBe(
      '\n# repos CLI work command\neval "$(repos init --print)"\n'
    );
  });

  test('--force removes old block completely (no duplicates)', async () => {
    // Run init twice with force - should not duplicate
    await runInit(['--force']);
    await runInit(['--force']);

    const zshrc = await readFile(join(testHome, '.zshrc'), 'utf-8');

    // Count occurrences of the marker
    const matches = zshrc.match(/# repos CLI work command/g);
    expect(matches?.length).toBe(1);
  });
});
