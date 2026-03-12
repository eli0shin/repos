import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  spyOn,
  type Mock,
} from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { runGitCommand, cloneBare } from '../src/git/index.ts';
import { writeConfig } from '../src/config.ts';
import type { ReposConfig } from '../src/types.ts';
import * as tmux from '../src/tmux.ts';
import { workCommand } from '../src/commands/work.ts';
import { stackCommand } from '../src/commands/stack.ts';

async function createTestRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await runGitCommand(['init', '-b', 'main'], dir);
  await Bun.write(join(dir, 'test.txt'), 'test');
  await runGitCommand(['add', '.'], dir);
  await runGitCommand(['commit', '-m', 'initial'], dir);
}

describe('--tmux flag', () => {
  const testDir = '/tmp/repos-test-tmux-flag';
  const sourceDir = '/tmp/repos-test-tmux-flag-source';
  const configPath = '/tmp/repos-test-tmux-flag-config/config.json';
  let originalCwd: string;
  let openTmuxSessionSpy: Mock<typeof tmux.openTmuxSession>;

  beforeEach(async () => {
    originalCwd = process.cwd();
    openTmuxSessionSpy = spyOn(tmux, 'openTmuxSession').mockResolvedValue(
      undefined
    );
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    openTmuxSessionSpy.mockRestore();
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-tmux-flag-config', {
      recursive: true,
      force: true,
    });
  });

  async function setupBareRepo(): Promise<{
    bareDir: string;
    config: ReposConfig;
  }> {
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);
    return { bareDir, config };
  }

  function captureStdout(): { output: string[]; restore: () => void } {
    const output: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      output.push(chunk);
      return true;
    };
    return { output, restore: () => (process.stdout.write = originalWrite) };
  }

  test('work --tmux calls openTmuxSession and prints nothing to stdout', async () => {
    await setupBareRepo();
    const { output, restore } = captureStdout();

    await workCommand({ configPath }, 'feature', 'bare', { tmux: true });
    restore();

    const worktreePath = join(testDir, 'bare.git-feature');
    expect(openTmuxSessionSpy).toHaveBeenCalledTimes(1);
    expect(openTmuxSessionSpy).toHaveBeenCalledWith(
      'bare',
      'feature',
      worktreePath
    );
    // No path printed to stdout when --tmux is used
    const stdoutText = output.join('');
    expect(stdoutText).not.toContain(worktreePath);
  });

  test('work --tmux on existing worktree calls openTmuxSession with existing path', async () => {
    const { bareDir } = await setupBareRepo();

    // Create worktree manually first
    const worktreePath = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    const { output, restore } = captureStdout();

    await workCommand({ configPath }, 'feature', 'bare', { tmux: true });
    restore();

    expect(openTmuxSessionSpy).toHaveBeenCalledTimes(1);
    expect(openTmuxSessionSpy).toHaveBeenCalledWith(
      'bare',
      'feature',
      realpathSync(worktreePath)
    );
    const stdoutText = output.join('');
    expect(stdoutText).not.toContain(worktreePath);
  });

  test('work without --tmux does not call openTmuxSession', async () => {
    await setupBareRepo();
    const { output, restore } = captureStdout();

    await workCommand({ configPath }, 'feature', 'bare');
    restore();

    expect(openTmuxSessionSpy).toHaveBeenCalledTimes(0);
    const worktreePath = join(testDir, 'bare.git-feature');
    expect(output.join('')).toEqual(worktreePath + '\n');
  });

  test('stack --tmux calls openTmuxSession and prints nothing to stdout', async () => {
    const { bareDir } = await setupBareRepo();

    // Create parent worktree to stack from
    const parentPath = join(testDir, 'bare.git-parent');
    await runGitCommand(
      ['worktree', 'add', '-b', 'parent', parentPath],
      bareDir
    );
    await Bun.write(join(parentPath, 'parent.txt'), 'parent');
    await runGitCommand(['add', '.'], parentPath);
    await runGitCommand(['commit', '-m', 'parent commit'], parentPath);

    process.chdir(parentPath);

    const { output, restore } = captureStdout();

    await stackCommand({ configPath }, 'child', { tmux: true });
    restore();

    const childPath = join(testDir, 'bare.git-child');
    expect(openTmuxSessionSpy).toHaveBeenCalledTimes(1);
    expect(openTmuxSessionSpy).toHaveBeenCalledWith('bare', 'child', childPath);
    const stdoutText = output.join('');
    expect(stdoutText).not.toContain(childPath);
  });

  test('stack without --tmux does not call openTmuxSession', async () => {
    const { bareDir } = await setupBareRepo();

    // Create parent worktree to stack from
    const parentPath = join(testDir, 'bare.git-parent');
    await runGitCommand(
      ['worktree', 'add', '-b', 'parent', parentPath],
      bareDir
    );
    await Bun.write(join(parentPath, 'parent.txt'), 'parent');
    await runGitCommand(['add', '.'], parentPath);
    await runGitCommand(['commit', '-m', 'parent commit'], parentPath);

    process.chdir(parentPath);

    const { output, restore } = captureStdout();

    await stackCommand({ configPath }, 'child');
    restore();

    expect(openTmuxSessionSpy).toHaveBeenCalledTimes(0);
    const childPath = join(testDir, 'bare.git-child');
    expect(output.join('')).toEqual(childPath + '\n');
  });
});
