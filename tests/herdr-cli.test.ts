import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeConfig } from '../src/config.ts';
import { cloneRepo, runGitCommand } from '../src/git/index.ts';
import { createTestRepo, matchString } from './helpers.ts';
import { createFakeHerdr, readFakeHerdrState } from './fake-herdr.ts';

const root = import.meta.dir.replace('/tests', '');
const testDir = `/tmp/repos-test-herdr-cli-${process.pid}`;
const seedPath = join(testDir, 'seed');
const remotePath = join(testDir, 'remote.git');
const repoPath = join(testDir, 'repo');
const configHome = join(testDir, 'config');
const configPath = join(configHome, 'repos', 'config.json');
const fakeDir = `/tmp/repos-test-herdr-cli-bin-${process.pid}`;
const parentPath = join(testDir, 'repo-parent');
const childPath = join(testDir, 'repo-child');
let statePath: string;
let serverSocketPath: string;
let serverReadyPath: string;

async function runCli(
  args: string[],
  cwd = root,
  overrides: Record<string, string | undefined> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const environment = Object.fromEntries(
    Object.entries({
      ...process.env,
      XDG_CONFIG_HOME: configHome,
      FAKE_HERDR_STATE: statePath,
      FAKE_HERDR_SERVER_SOCKET: serverSocketPath,
      FAKE_HERDR_SERVER_READY: serverReadyPath,
      PATH: `${fakeDir}:${process.env.PATH}`,
      TMUX: undefined,
      HERDR_ENV: undefined,
      HERDR_BIN_PATH: undefined,
      HERDR_SOCKET_PATH: undefined,
      HERDR_SESSION: undefined,
      HERDR_WORKSPACE_ID: undefined,
      ...overrides,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  const proc = Bun.spawn(['bun', 'run', join(root, 'src/cli.ts'), ...args], {
    cwd,
    env: environment,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe.serial('Herdr CLI worktree workflow', () => {
  beforeAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(fakeDir, { recursive: true, force: true });
    await createTestRepo(seedPath);
    await runGitCommand(['branch', '-M', 'main'], seedPath);
    await runGitCommand(['init', '--bare', remotePath], testDir);
    await runGitCommand(['remote', 'add', 'origin', remotePath], seedPath);
    await runGitCommand(['push', '-u', 'origin', 'main'], seedPath);
    const cloned = await cloneRepo(remotePath, repoPath);
    if (!cloned.success) throw new Error(cloned.error);
    await writeConfig(configPath, {
      repos: [{ name: 'repo', url: remotePath, path: repoPath }],
      config: { updateBehavior: 'off', workspaceManager: 'herdr' },
    });
    const fake = await createFakeHerdr(fakeDir);
    statePath = fake.statePath;
    serverSocketPath = fake.serverSocketPath;
    serverReadyPath = fake.serverReadyPath;
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(fakeDir, { recursive: true, force: true });
  });

  test('preserves opt-out behavior without opening a Managed Workspace', async () => {
    const plainPath = join(testDir, 'repo-plain');
    expect(await runCli(['work', '--no-tmux', 'plain', 'repo'])).toEqual({
      stdout: `${plainPath}\n`,
      stderr:
        'Creating worktree for "plain"...\nCreated worktree "repo-plain"\n',
      exitCode: 0,
    });
    expect((await readFakeHerdrState(statePath)).workspaces).toEqual([]);

    expect(
      await runCli(['clean', '--no-tmux', 'plain', 'repo'], plainPath)
    ).toEqual({
      stdout: `${repoPath}\n`,
      stderr:
        'Removing worktree for "plain"...\nRemoved worktree "repo-plain"\n',
      exitCode: 0,
    });
  });

  test('work and indexed work open, reuse, and focus the Herdr workspace', async () => {
    expect(await runCli(['work', '--no-focus', 'parent', 'repo'])).toEqual({
      stdout: `${parentPath}\n`,
      stderr:
        'Creating worktree for "parent"...\nCreated worktree "repo-parent"\nOpened Herdr workspace "repo@parent"\n',
      exitCode: 0,
    });

    const beforeDefault = await readFakeHerdrState(statePath);
    expect(await runCli(['work', '-i', '1', 'repo'])).toEqual({
      stdout: `${parentPath}\n`,
      stderr: '',
      exitCode: 0,
    });
    expect((await readFakeHerdrState(statePath)).calls).toEqual(
      beforeDefault.calls
    );

    const herdrEnvironment = {
      HERDR_ENV: '1',
      HERDR_BIN_PATH: join(fakeDir, 'herdr'),
      HERDR_SOCKET_PATH: join(testDir, 'herdr-test.sock'),
      HERDR_SESSION: `repos-test-${process.pid}`,
      TMUX: '/tmp/fake-tmux',
    };
    expect(
      await runCli(['work', '-i', '1', 'repo'], root, herdrEnvironment)
    ).toEqual({
      stdout: '',
      stderr: 'Attaching to existing Herdr workspace "repo@parent"\n',
      exitCode: 0,
    });
    expect((await readFakeHerdrState(statePath)).workspaces[0]?.focused).toBe(
      true
    );

    const beforeOptOut = await readFakeHerdrState(statePath);
    expect(
      await runCli(
        ['work', '--no-tmux', '-i', '1', 'repo'],
        root,
        herdrEnvironment
      )
    ).toEqual({ stdout: `${parentPath}\n`, stderr: '', exitCode: 0 });
    expect((await readFakeHerdrState(statePath)).calls).toEqual(
      beforeOptOut.calls
    );
  });

  test('stack and clean preserve paths and Herdr state in no-focus mode', async () => {
    expect(await runCli(['stack', '--no-focus', 'child'], parentPath)).toEqual({
      stdout: `${childPath}\n`,
      stderr:
        'Creating stacked branch "child" from "parent"...\nCreated stacked worktree "repo-child"\nOpened Herdr workspace "repo@child"\n',
      exitCode: 0,
    });

    expect(
      await runCli(['clean', '--no-focus', 'child', 'repo'], childPath)
    ).toEqual({
      stdout: `${parentPath}\n`,
      stderr:
        'Removing worktree for "child"...\nRemoved worktree "repo-child"\n',
      exitCode: 0,
    });
    expect((await readFakeHerdrState(statePath)).workspaces).toHaveLength(1);
    expect(await Bun.file(join(childPath, 'test.txt')).exists()).toBe(false);
  });

  test('cleanup previews and closes the exact stale-worktree workspace', async () => {
    await runGitCommand(['push', '-u', 'origin', 'parent'], parentPath);
    await runGitCommand(['push', 'origin', '--delete', 'parent'], repoPath);

    expect(await runCli(['cleanup', '--dry-run', '--tmux'], repoPath)).toEqual({
      stdout:
        'Would remove repo/parent (upstream deleted)\n\nWould remove 1 worktree(s) (1 upstream deleted)\nWould close Herdr workspace "repo@parent"\n',
      stderr: '',
      exitCode: 0,
    });
    expect((await readFakeHerdrState(statePath)).workspaces).toHaveLength(1);

    await runGitCommand(['worktree', 'lock', parentPath], repoPath);
    expect(await runCli(['cleanup', '--tmux'], repoPath)).toEqual({
      stdout: '',
      stderr: matchString(
        /^Error removing worktree parent: fatal: cannot remove a locked working tree[\s\S]+$/
      ),
      exitCode: 0,
    });
    expect((await readFakeHerdrState(statePath)).workspaces).toHaveLength(1);
    expect(await Bun.file(join(parentPath, 'test.txt')).exists()).toBe(true);
    await runGitCommand(['worktree', 'unlock', parentPath], repoPath);

    expect(await runCli(['cleanup', '--tmux'], repoPath)).toEqual({
      stdout:
        'Removed repo/parent (upstream deleted)\n\nRemoved 1 worktree(s) (1 upstream deleted)\nClosed Herdr workspace "repo@parent"\n',
      stderr: '',
      exitCode: 0,
    });
    expect((await readFakeHerdrState(statePath)).workspaces).toEqual([]);
    expect(await Bun.file(join(parentPath, 'test.txt')).exists()).toBe(false);
  });
});
