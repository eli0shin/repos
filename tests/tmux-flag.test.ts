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
import { runGitCommand, cloneBare, isGitRepo } from '../src/git/index.ts';
import { writeConfig } from '../src/config.ts';
import type { ReposConfig } from '../src/types.ts';
import * as tmux from '../src/tmux.ts';
import { workCommand } from '../src/commands/work.ts';
import { stackCommand } from '../src/commands/stack.ts';
import { cleanCommand } from '../src/commands/clean.ts';
import { cleanupCommand } from '../src/commands/cleanup.ts';

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
  // Unique repo name for tests that create real tmux sessions,
  // so session names (repo@branch) won't collide with the user's real sessions.
  const REAL_TMUX_REPO = 'repos-test-tmux-flag';
  const realTmuxSessionNames: string[] = [];

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
    for (const name of realTmuxSessionNames.splice(0)) {
      await tmux.tmuxKillSession(name);
    }
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-tmux-flag-config', {
      recursive: true,
      force: true,
    });
  });

  async function startRealTmuxSession(
    name: string,
    dir: string
  ): Promise<void> {
    realTmuxSessionNames.push(name);
    const result = await tmux.tmuxNewSession(name, dir);
    if (!result.success) throw new Error(result.error);
  }

  async function setupBareRepo(
    name = 'bare'
  ): Promise<{ bareDir: string; config: ReposConfig }> {
    const bareDir = join(testDir, `${name}.git`);
    await cloneBare(sourceDir, bareDir);
    const config = {
      repos: [{ name, url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);
    return { bareDir, config };
  }

  function captureStdout(): { output: string[]; restore: () => void } {
    const output: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      output.push(
        typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
      );
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
    expect(output).toEqual([]);
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
    expect(output).toEqual([]);
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

  async function setupStaleWorktree(
    repoName: string,
    branch: string
  ): Promise<{ bareDir: string; worktreePath: string }> {
    const { bareDir } = await setupBareRepo(repoName);
    const worktreePath = join(testDir, `${repoName}.git-${branch}`);
    await runGitCommand(
      ['worktree', 'add', '-b', branch, worktreePath],
      bareDir
    );
    await Bun.write(join(worktreePath, `${branch}.txt`), branch);
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', `${branch} work`], worktreePath);
    await runGitCommand(['push', '-u', 'origin', branch], worktreePath);
    await runGitCommand(['branch', '-D', branch], sourceDir);
    return { bareDir, worktreePath };
  }

  test('cleanup --tmux kills the tmux session for each removed worktree', async () => {
    const { worktreePath } = await setupStaleWorktree(
      REAL_TMUX_REPO,
      'feature'
    );
    const sessionName = `${REAL_TMUX_REPO}@feature`;
    await startRealTmuxSession(sessionName, worktreePath);

    const { restore } = captureStdout();
    await cleanupCommand({ configPath }, { dryRun: false, tmux: true });
    restore();

    expect(await isGitRepo(worktreePath)).toBe(false);
    const hasAfter = await tmux.tmuxHasSession(sessionName);
    expect(hasAfter).toEqual({ success: true, data: false });
  });

  test('cleanup --tmux is a no-op for worktrees without an existing session', async () => {
    const { worktreePath } = await setupStaleWorktree(
      REAL_TMUX_REPO,
      'feature'
    );
    const sessionName = `${REAL_TMUX_REPO}@feature`;

    const { output, restore } = captureStdout();
    await cleanupCommand({ configPath }, { dryRun: false, tmux: true });
    restore();

    expect(await isGitRepo(worktreePath)).toBe(false);
    const hasAfter = await tmux.tmuxHasSession(sessionName);
    expect(hasAfter).toEqual({ success: true, data: false });
    expect(output.join('')).not.toContain('Killed tmux session');
  });

  test('cleanup --tmux --dry-run reports without killing', async () => {
    const { worktreePath } = await setupStaleWorktree(
      REAL_TMUX_REPO,
      'feature'
    );
    const sessionName = `${REAL_TMUX_REPO}@feature`;
    await startRealTmuxSession(sessionName, worktreePath);

    const { output, restore } = captureStdout();
    await cleanupCommand({ configPath }, { dryRun: true, tmux: true });
    restore();

    expect(await isGitRepo(worktreePath)).toBe(true);
    const hasAfter = await tmux.tmuxHasSession(sessionName);
    expect(hasAfter).toEqual({ success: true, data: true });
    expect(output.join('')).toContain(
      `Would kill tmux session "${sessionName}"`
    );
  });

  test('cleanup without --tmux leaves the tmux session alone', async () => {
    const { worktreePath } = await setupStaleWorktree(
      REAL_TMUX_REPO,
      'feature'
    );
    const sessionName = `${REAL_TMUX_REPO}@feature`;
    await startRealTmuxSession(sessionName, worktreePath);

    const { restore } = captureStdout();
    await cleanupCommand({ configPath }, { dryRun: false, tmux: false });
    restore();

    expect(await isGitRepo(worktreePath)).toBe(false);
    const hasAfter = await tmux.tmuxHasSession(sessionName);
    expect(hasAfter).toEqual({ success: true, data: true });
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
    expect(output).toEqual([]);
  });

  test('clean --tmux kills worktree session and opens main session', async () => {
    const { bareDir } = await setupBareRepo(REAL_TMUX_REPO);

    const worktreePath = join(testDir, `${REAL_TMUX_REPO}.git-feature`);
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );
    const mainPath = join(testDir, `${REAL_TMUX_REPO}.git-main`);
    await runGitCommand(['worktree', 'add', mainPath, 'main'], bareDir);

    const sessionName = `${REAL_TMUX_REPO}@feature`;
    await startRealTmuxSession(sessionName, worktreePath);

    process.chdir(worktreePath);

    const { output, restore } = captureStdout();
    await cleanCommand({ configPath }, 'feature', REAL_TMUX_REPO, {
      force: false,
      dryRun: false,
      tmux: true,
    });
    restore();

    expect(await isGitRepo(worktreePath)).toBe(false);
    const hasAfter = await tmux.tmuxHasSession(sessionName);
    expect(hasAfter).toEqual({ success: true, data: false });
    expect(openTmuxSessionSpy).toHaveBeenCalledTimes(1);
    expect(openTmuxSessionSpy).toHaveBeenCalledWith(
      REAL_TMUX_REPO,
      'main',
      realpathSync(mainPath)
    );
    // No path printed to stdout when --tmux is used
    expect(output).toEqual([]);
  });

  test('clean --tmux opens main session even when no worktree session exists', async () => {
    const { bareDir } = await setupBareRepo(REAL_TMUX_REPO);
    const worktreePath = join(testDir, `${REAL_TMUX_REPO}.git-feature`);
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );
    const mainPath = join(testDir, `${REAL_TMUX_REPO}.git-main`);
    await runGitCommand(['worktree', 'add', mainPath, 'main'], bareDir);

    process.chdir(worktreePath);

    const { restore } = captureStdout();
    await cleanCommand({ configPath }, 'feature', REAL_TMUX_REPO, {
      force: false,
      dryRun: false,
      tmux: true,
    });
    restore();

    expect(await isGitRepo(worktreePath)).toBe(false);
    expect(openTmuxSessionSpy).toHaveBeenCalledTimes(1);
    expect(openTmuxSessionSpy).toHaveBeenCalledWith(
      REAL_TMUX_REPO,
      'main',
      realpathSync(mainPath)
    );
  });

  test('clean --tmux --dry-run does not touch tmux', async () => {
    const { bareDir } = await setupBareRepo(REAL_TMUX_REPO);
    const worktreePath = join(testDir, `${REAL_TMUX_REPO}.git-feature`);
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    const sessionName = `${REAL_TMUX_REPO}@feature`;
    await startRealTmuxSession(sessionName, worktreePath);

    const { restore } = captureStdout();
    await cleanCommand({ configPath }, 'feature', REAL_TMUX_REPO, {
      force: false,
      dryRun: true,
      tmux: true,
    });
    restore();

    expect(await isGitRepo(worktreePath)).toBe(true);
    const hasAfter = await tmux.tmuxHasSession(sessionName);
    expect(hasAfter).toEqual({ success: true, data: true });
    expect(openTmuxSessionSpy).toHaveBeenCalledTimes(0);
  });

  test('clean without --tmux leaves the tmux session alone', async () => {
    const { bareDir } = await setupBareRepo(REAL_TMUX_REPO);
    const worktreePath = join(testDir, `${REAL_TMUX_REPO}.git-feature`);
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );
    const sessionName = `${REAL_TMUX_REPO}@feature`;
    await startRealTmuxSession(sessionName, worktreePath);

    const { output, restore } = captureStdout();
    await cleanCommand({ configPath }, 'feature', REAL_TMUX_REPO, {
      force: false,
      dryRun: false,
      tmux: false,
    });
    restore();

    expect(await isGitRepo(worktreePath)).toBe(false);
    expect(output.join('')).toContain(realpathSync(bareDir));
    const hasAfter = await tmux.tmuxHasSession(sessionName);
    expect(hasAfter).toEqual({ success: true, data: true });
    expect(openTmuxSessionSpy).toHaveBeenCalledTimes(0);
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

  test('clean --tmux on non-bare repo opens main session at the main worktree', async () => {
    // Non-bare path: the main worktree IS the first worktree (default branch
    // checked out). Verify main-path resolution finds that, not the repo dir.
    const repoDir = join(testDir, `${REAL_TMUX_REPO}-nonbare`);
    await runGitCommand(['clone', sourceDir, repoDir]);
    const config = {
      repos: [{ name: REAL_TMUX_REPO, url: sourceDir, path: repoDir }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const worktreePath = join(testDir, `${REAL_TMUX_REPO}-nonbare-feature`);
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      repoDir
    );

    const sessionName = `${REAL_TMUX_REPO}@feature`;
    await startRealTmuxSession(sessionName, worktreePath);

    process.chdir(worktreePath);

    const { restore } = captureStdout();
    await cleanCommand({ configPath }, 'feature', REAL_TMUX_REPO, {
      force: false,
      dryRun: false,
      tmux: true,
    });
    restore();

    expect(await isGitRepo(worktreePath)).toBe(false);
    const hasAfter = await tmux.tmuxHasSession(sessionName);
    expect(hasAfter).toEqual({ success: true, data: false });
    expect(openTmuxSessionSpy).toHaveBeenCalledTimes(1);
    expect(openTmuxSessionSpy).toHaveBeenCalledWith(
      REAL_TMUX_REPO,
      'main',
      realpathSync(repoDir)
    );
  });

  test('clean --tmux --force removes a parent worktree with stacked children and still opens main', async () => {
    const { bareDir } = await setupBareRepo(REAL_TMUX_REPO);

    const parentPath = join(testDir, `${REAL_TMUX_REPO}.git-parent`);
    await runGitCommand(
      ['worktree', 'add', '-b', 'parent', parentPath],
      bareDir
    );
    await Bun.write(join(parentPath, 'parent.txt'), 'parent');
    await runGitCommand(['add', '.'], parentPath);
    await runGitCommand(['commit', '-m', 'parent commit'], parentPath);

    // Create a stacked child off parent via the stack command so stack
    // metadata exists in the config — exercises the force cleanup path.
    process.chdir(parentPath);
    await stackCommand({ configPath }, 'child');

    const mainPath = join(testDir, `${REAL_TMUX_REPO}.git-main`);
    await runGitCommand(['worktree', 'add', mainPath, 'main'], bareDir);

    const sessionName = `${REAL_TMUX_REPO}@parent`;
    await startRealTmuxSession(sessionName, parentPath);

    process.chdir(parentPath);

    const { restore } = captureStdout();
    await cleanCommand({ configPath }, 'parent', REAL_TMUX_REPO, {
      force: true,
      dryRun: false,
      tmux: true,
    });
    restore();

    expect(await isGitRepo(parentPath)).toBe(false);
    const hasAfter = await tmux.tmuxHasSession(sessionName);
    expect(hasAfter).toEqual({ success: true, data: false });
    expect(openTmuxSessionSpy).toHaveBeenCalledTimes(1);
    expect(openTmuxSessionSpy).toHaveBeenCalledWith(
      REAL_TMUX_REPO,
      'main',
      realpathSync(mainPath)
    );
  });
});
