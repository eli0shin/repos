import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { runGitCommand, cloneBare } from '../src/git.ts';
import { listCommand } from '../src/commands/list.ts';
import { writeConfig } from '../src/config.ts';
import type { ReposConfig } from '../src/types.ts';

// Helper to create a test repo with commits
async function createTestRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await runGitCommand(['init'], dir);
  await runGitCommand(['config', 'user.email', 'test@test.com'], dir);
  await runGitCommand(['config', 'user.name', 'Test'], dir);
  await Bun.write(join(dir, 'test.txt'), 'test');
  await runGitCommand(['add', '.'], dir);
  await runGitCommand(['commit', '-m', 'initial'], dir);
}

// Helper to capture stdout
function captureStdout(): { output: string[]; restore: () => void } {
  const output: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string) => {
    output.push(chunk);
    return true;
  };
  return {
    output,
    restore: () => {
      process.stdout.write = originalWrite;
    },
  };
}

describe('repos list command', () => {
  const testDir = '/tmp/repos-test-list-cmd';
  const sourceDir = '/tmp/repos-test-list-cmd-source';
  const configPath = '/tmp/repos-test-list-cmd-config/config.json';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-list-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('lists regular repo as cloned', async () => {
    const repoDir = join(testDir, 'repo');
    await runGitCommand(['clone', sourceDir, repoDir]);

    const config = {
      repos: [{ name: 'repo', url: sourceDir, path: realpathSync(repoDir) }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const capture = captureStdout();
    await listCommand({ configPath });
    capture.restore();

    expect(capture.output.join('')).toBe(
      'Tracked repositories:\n\n' +
        `  repo ✓\n` +
        `    ${realpathSync(repoDir)}\n`
    );
  });

  test('lists bare repo as cloned', async () => {
    const bareDir = join(testDir, 'project.git');
    await cloneBare(sourceDir, bareDir);

    const config = {
      repos: [
        {
          name: 'project',
          url: sourceDir,
          path: realpathSync(bareDir),
          bare: true,
        },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const capture = captureStdout();
    await listCommand({ configPath });
    capture.restore();

    expect(capture.output.join('')).toBe(
      'Tracked repositories:\n\n' +
        `  project (bare) ✓\n` +
        `    ${realpathSync(bareDir)}\n`
    );
  });

  test('shows not cloned for missing repo', async () => {
    const config = {
      repos: [
        { name: 'missing', url: sourceDir, path: '/tmp/does-not-exist-xyz' },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const capture = captureStdout();
    await listCommand({ configPath });
    capture.restore();

    expect(capture.output.join('')).toBe(
      'Tracked repositories:\n\n' +
        '  missing ✗ not cloned\n' +
        '    /tmp/does-not-exist-xyz\n'
    );
  });

  test('shows worktrees for bare repo', async () => {
    const bareDir = join(testDir, 'project.git');
    await cloneBare(sourceDir, bareDir);

    // Create a worktree
    const worktreePath = join(testDir, 'project.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    const config = {
      repos: [
        {
          name: 'project',
          url: sourceDir,
          path: realpathSync(bareDir),
          bare: true,
        },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const capture = captureStdout();
    await listCommand({ configPath });
    capture.restore();

    expect(capture.output.join('')).toBe(
      'Tracked repositories:\n\n' +
        `  project (bare) ✓\n` +
        `    ${realpathSync(bareDir)}\n` +
        `      ↳ feature: ${realpathSync(worktreePath)}\n`
    );
  });

  test('prints guidance when config is empty', async () => {
    await writeConfig(configPath, { repos: [] });

    const capture = captureStdout();
    await listCommand({ configPath });
    capture.restore();

    expect(capture.output.join('')).toBe(
      'No repos tracked. Use "repos add <url>" to add one.\n'
    );
  });
});
