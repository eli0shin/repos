import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeConfig } from '../src/config.ts';
import { cloneRepo, runGitCommand } from '../src/git/index.ts';
import type { WorkspaceManagerProvider } from '../src/types.ts';
import { resolveWorkspaceManagerProvider } from '../src/workspace-manager/index.ts';
import { getCollisionSafeManagedWorkspaceName } from '../src/workspace-manager/name.ts';
import {
  createFakeHerdrApp,
  fakeSpace,
  readFakeHerdrAppState,
  type FakeHerdrAppState,
} from './fake-herdr-app.ts';
import { createTestRepo } from './helpers.ts';

const root = import.meta.dir.replace('/tests', '');
// Git reports resolved paths, such as /private/tmp on macOS.
const testDir = join(
  realpathSync('/tmp'),
  `repos-test-herdr-app-cli-${process.pid}`
);
const fakeDir = join(testDir, 'bin');
const seedPath = join(testDir, 'seed');
const remotePath = join(testDir, 'remote.git');
const repoPath = join(testDir, 'repo');
const configHome = join(testDir, 'config');
const configPath = join(configHome, 'repos', 'config.json');
const parentPath = join(testDir, 'repo-parent');
const childPath = join(testDir, 'repo-child');
const home = fakeSpace('sp0', 'home', testDir);
let statePath: string;

async function setup(
  initial: Partial<FakeHerdrAppState> = {},
  workspaceManager: WorkspaceManagerProvider = 'herdr-app'
): Promise<void> {
  await createTestRepo(seedPath);
  await runGitCommand(['branch', '-M', 'main'], seedPath);
  await runGitCommand(['init', '--bare', remotePath], testDir);
  await runGitCommand(['symbolic-ref', 'HEAD', 'refs/heads/main'], remotePath);
  await runGitCommand(['remote', 'add', 'origin', remotePath], seedPath);
  await runGitCommand(['push', '-u', 'origin', 'main'], seedPath);
  const cloned = await cloneRepo(remotePath, repoPath);
  if (!cloned.success) throw new Error(cloned.error);
  await writeConfig(configPath, {
    repos: [{ name: 'repo', url: remotePath, path: repoPath }],
    config: { updateBehavior: 'off', workspaceManager },
  });
  ({ statePath } = await createFakeHerdrApp(fakeDir, {
    spaces: [home],
    selectedSpace: 'sp0',
    focusedPane: 'pa-sp0',
    ...initial,
  }));
}

async function runCli(
  args: string[],
  cwd = root,
  overrides: Record<string, string | undefined> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const environment = Object.fromEntries(
    Object.entries({
      ...process.env,
      XDG_CONFIG_HOME: configHome,
      FAKE_HERDR_APP_STATE: statePath,
      PATH: `${fakeDir}:${process.env.PATH}`,
      TMUX: undefined,
      HERDR_ENV: undefined,
      HC_TERMINAL_ID: undefined,
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

async function window(): Promise<
  Pick<FakeHerdrAppState, 'selectedSpace' | 'focusedPane' | 'raised'> & {
    spaces: { id: string; name: string; folder: string }[];
  }
> {
  const state = await readFakeHerdrAppState(statePath);
  return {
    spaces: state.spaces.map(({ id, name, folder }) => ({ id, name, folder })),
    selectedSpace: state.selectedSpace,
    focusedPane: state.focusedPane,
    raised: state.raised,
  };
}

const homeSpace = { id: 'sp0', name: 'home', folder: testDir };

describe('Herdr app provider resolution', () => {
  test('the Herdr app ranks below legacy Herdr and tmux, above config, and needs this window to show the terminal', async () => {
    const remote = {
      ...fakeSpace('vps/sp1', 'remote', '/srv', 'vps/t2'),
      machine: 'vps',
    };
    const spaces = [fakeSpace('sp0', 'home', testDir, 't1'), remote];
    const fake = await createFakeHerdrApp(fakeDir, { spaces });
    const app = {
      HC_TERMINAL_ID: 't1',
      PATH: fakeDir,
      FAKE_HERDR_APP_STATE: fake.statePath,
    };
    expect([
      resolveWorkspaceManagerProvider('tmux', app),
      resolveWorkspaceManagerProvider('herdr-app', app),
      resolveWorkspaceManagerProvider('herdr-app', {}),
      resolveWorkspaceManagerProvider('herdr-app', { ...app, TMUX: '/t' }),
      resolveWorkspaceManagerProvider('tmux', { ...app, HERDR_ENV: '1' }),
      // A terminal on another machine has the same markers; this window
      // shows it only under that machine.
      resolveWorkspaceManagerProvider('tmux', { ...app, HC_TERMINAL_ID: 't2' }),
      resolveWorkspaceManagerProvider('tmux', { ...app, PATH: '/nonexistent' }),
    ]).toEqual([
      'herdr-app',
      'herdr-app',
      'herdr-app',
      'tmux',
      'herdr',
      'tmux',
      'tmux',
    ]);

    await createFakeHerdrApp(fakeDir, { spaces, window: false });
    expect(resolveWorkspaceManagerProvider('tmux', app)).toBe('tmux');
    await rm(fakeDir, { recursive: true, force: true });
  });
});

describe.serial('Herdr app CLI worktree workflow', () => {
  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('work and stack open spaces without moving focus, and show them on request', async () => {
    await setup();
    expect(await runCli(['work', '--no-focus', 'parent', 'repo'])).toEqual({
      stdout: `${parentPath}\n`,
      stderr:
        'Creating worktree for "parent"...\nCreated worktree "repo-parent"\nOpened Herdr app space "repo@parent"\n',
      exitCode: 0,
    });
    expect(await runCli(['work', '--no-focus', 'parent', 'repo'])).toEqual({
      stdout: `${parentPath}\n`,
      stderr: '',
      exitCode: 0,
    });
    const parentSpace = { id: 'sp1', name: 'repo@parent', folder: parentPath };
    expect(await window()).toEqual({
      spaces: [homeSpace, parentSpace],
      selectedSpace: 'sp0',
      focusedPane: 'pa-sp0',
      raised: 0,
    });

    expect(await runCli(['work', '-t', 'parent', 'repo'])).toEqual({
      stdout: '',
      stderr: 'Showing existing Herdr app space "repo@parent"\n',
      exitCode: 0,
    });
    expect(await window()).toEqual({
      spaces: [homeSpace, parentSpace],
      selectedSpace: 'sp1',
      focusedPane: 'pa1',
      raised: 1,
    });

    expect(await runCli(['stack', '--no-focus', 'child'], parentPath)).toEqual({
      stdout: `${childPath}\n`,
      stderr:
        'Creating stacked branch "child" from "parent"...\nCreated stacked worktree "repo-child"\nOpened Herdr app space "repo@child"\n',
      exitCode: 0,
    });
    expect(await window()).toEqual({
      spaces: [
        homeSpace,
        parentSpace,
        { id: 'sp2', name: 'repo@child', folder: childPath },
      ],
      selectedSpace: 'sp1',
      focusedPane: 'pa1',
      raised: 1,
    });
  });

  test('inside the Herdr app, work shows a new space by default over a tmux setting', async () => {
    await setup({}, 'tmux');
    const featurePath = join(testDir, 'repo-feature');
    expect(
      await runCli(['work', 'feature', 'repo'], root, {
        HC_TERMINAL_ID: 't-sp0',
      })
    ).toEqual({
      stdout: '',
      stderr:
        'Creating worktree for "feature"...\nCreated worktree "repo-feature"\nOpened Herdr app space "repo@feature"\n',
      exitCode: 0,
    });
    expect(await window()).toEqual({
      spaces: [
        homeSpace,
        { id: 'sp1', name: 'repo@feature', folder: featurePath },
      ],
      selectedSpace: 'sp1',
      focusedPane: 'pa1',
      raised: 0,
    });
    // A terminal this window doesn't show, such as one on another machine,
    // stays unmanaged.
    const otherPath = join(testDir, 'repo-other');
    expect(
      await runCli(['work', 'other', 'repo'], root, { HC_TERMINAL_ID: 't7' })
    ).toEqual({
      stdout: `${otherPath}\n`,
      stderr:
        'Creating worktree for "other"...\nCreated worktree "repo-other"\n',
      exitCode: 0,
    });
    expect((await window()).spaces).toHaveLength(2);
  });

  test('clean keeps the active space with --no-focus, and otherwise moves to the destination first', async () => {
    await setup();
    await runCli(['work', '--no-focus', 'parent', 'repo']);
    const inParentSpace = { HC_TERMINAL_ID: 't1' };

    expect(
      await runCli(
        ['clean', '--no-focus', 'parent', 'repo'],
        parentPath,
        inParentSpace
      )
    ).toEqual({
      stdout: '',
      stderr:
        'Error: Cannot clean the active Herdr app space "repo@parent" with --no-focus.\n',
      exitCode: 1,
    });
    expect(await Bun.file(join(parentPath, 'test.txt')).exists()).toBe(true);

    expect(
      await runCli(['clean', 'parent', 'repo'], parentPath, inParentSpace)
    ).toEqual({
      stdout: '',
      stderr:
        'Removing worktree for "parent"...\nRemoved worktree "repo-parent"\nOpened Herdr app space "repo@main"\n',
      exitCode: 0,
    });
    expect(await Bun.file(join(parentPath, 'test.txt')).exists()).toBe(false);
    expect(await window()).toEqual({
      spaces: [homeSpace, { id: 'sp2', name: 'repo@main', folder: repoPath }],
      selectedSpace: 'sp2',
      focusedPane: 'pa2',
      raised: 0,
    });
  });

  test('cleanup previews and closes the stale-worktree space', async () => {
    await setup();
    await runCli(['work', '--no-focus', 'parent', 'repo']);
    await runGitCommand(['push', '-u', 'origin', 'parent'], parentPath);
    await runGitCommand(['push', 'origin', '--delete', 'parent'], repoPath);

    expect(await runCli(['cleanup', '--dry-run', '--tmux'], repoPath)).toEqual({
      stdout:
        'Would remove repo/parent (upstream deleted)\n\nWould remove 1 worktree(s) (1 upstream deleted)\nWould close Herdr app space "repo@parent"\n',
      stderr: '',
      exitCode: 0,
    });
    expect((await window()).spaces).toHaveLength(2);

    expect(await runCli(['cleanup', '--tmux'], repoPath)).toEqual({
      stdout:
        'Removed repo/parent (upstream deleted)\n\nRemoved 1 worktree(s) (1 upstream deleted)\nClosed Herdr app space "repo@parent"\n',
      stderr: '',
      exitCode: 0,
    });
    expect(await window()).toEqual({
      spaces: [homeSpace],
      selectedSpace: 'sp0',
      focusedPane: 'pa-sp0',
      raised: 0,
    });
  });

  test('keeps colliding branch spaces distinct', async () => {
    await setup();
    const slashPath = join(testDir, 'repo-feature-x');
    await runGitCommand(['checkout', '-b', 'feature-x'], repoPath);
    expect(
      await runCli(['work', '--no-focus', 'feature-x', 'repo'], repoPath)
    ).toEqual({
      stdout: `${repoPath}\n`,
      stderr: 'Opened Herdr app space "repo@feature-x"\n',
      exitCode: 0,
    });
    expect(
      await runCli(['work', '--no-focus', 'feature/x', 'repo'], repoPath)
    ).toEqual({
      stdout: `${slashPath}\n`,
      stderr:
        'Creating worktree for "feature/x"...\n' +
        'Created worktree "repo-feature-x"\n' +
        `Opened Herdr app space "${getCollisionSafeManagedWorkspaceName('repo', 'feature/x')}"\n`,
      exitCode: 0,
    });
    expect((await window()).spaces).toEqual([
      homeSpace,
      { id: 'sp1', name: 'repo@feature-x', folder: repoPath },
      {
        id: 'sp2',
        name: getCollisionSafeManagedWorkspaceName('repo', 'feature/x'),
        folder: slashPath,
      },
    ]);
  });

  test('without a window, opening fails clearly and cleaning still removes the worktree', async () => {
    await setup({ window: false });
    expect(await runCli(['work', '--no-focus', 'parent', 'repo'])).toEqual({
      stdout: '',
      stderr:
        'Creating worktree for "parent"...\n' +
        'Created worktree "repo-parent"\n' +
        'Error: The Herdr app is not open. Open it and retry (herdr-app: no Herdr window at /fake/herdr-app.sock: No such file or directory (os error 2))\n',
      exitCode: 1,
    });

    expect(
      await runCli(['clean', '--no-focus', 'parent', 'repo'], parentPath)
    ).toEqual({
      stdout: `${repoPath}\n`,
      stderr:
        'Warning: the Herdr app is not open, so no Herdr app spaces were closed\n' +
        'Removing worktree for "parent"...\nRemoved worktree "repo-parent"\n',
      exitCode: 0,
    });
    expect(await Bun.file(join(parentPath, 'test.txt')).exists()).toBe(false);
  });
});
