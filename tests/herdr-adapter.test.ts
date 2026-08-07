import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  resolveWorkspaceManagerProvider,
  type ClosureFocusIntent,
  type ClosurePlanOptions,
  type ManagedWorkspaceTarget,
} from '../src/workspace-manager/index.ts';
import {
  openWithHerdr,
  planHerdrClosure,
  type HerdrAdapterDependencies,
} from '../src/workspace-manager/herdr-adapter.ts';
import { getCollisionSafeManagedWorkspaceName } from '../src/workspace-manager/name.ts';
import {
  createFakeHerdr,
  readFakeHerdrState,
  type FakeHerdrWorkspace,
} from './fake-herdr.ts';
import { mockProcessExit, type MockExit } from './utils.ts';

const testDir = `/tmp/repos-test-herdr-adapter-${process.pid}`;
const fakeDir = join(testDir, 'bin');
const targetPath = join(testDir, 'repo-feature');
const otherPath = join(testDir, 'repo-other');
const unrelatedPath = join(testDir, 'repo-unrelated');
const target = {
  repoName: 'repo',
  branch: 'feature/one',
  worktreePath: targetPath,
} satisfies ManagedWorkspaceTarget;
const collisionSafeTargetName = getCollisionSafeManagedWorkspaceName(
  target.repoName,
  target.branch
);

function workspace(
  id: string,
  label: string,
  path: string,
  repoRoot = '/repo',
  focused = false
): FakeHerdrWorkspace {
  return {
    workspace_id: id,
    label,
    focused,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: `${id}:t1`,
    agent_status: 'unknown',
    worktree: {
      repo_key: repoRoot,
      repo_name: 'repo',
      repo_root: repoRoot,
      checkout_path: path,
      is_linked_worktree: true,
    },
  };
}

function captureStream(stream: NodeJS.WriteStream): {
  output: string[];
  restore: () => void;
} {
  const output: string[] = [];
  const originalWrite = stream.write.bind(stream);
  stream.write = (chunk: string | Uint8Array) => {
    output.push(
      typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    );
    return true;
  };
  return { output, restore: () => (stream.write = originalWrite) };
}

describe('Workspace Manager provider resolution', () => {
  test('uses environment markers before config and defaults to tmux', () => {
    expect([
      resolveWorkspaceManagerProvider(undefined, {}),
      resolveWorkspaceManagerProvider('herdr', {}),
      resolveWorkspaceManagerProvider('herdr', { TMUX: '/tmp/tmux' }),
      resolveWorkspaceManagerProvider('tmux', { HERDR_ENV: '1' }),
      resolveWorkspaceManagerProvider('tmux', {
        HERDR_ENV: '1',
        TMUX: '/tmp/tmux',
      }),
    ]).toEqual(['tmux', 'herdr', 'tmux', 'herdr', 'herdr']);
  });
});

describe.serial('Herdr Workspace Manager adapter', () => {
  let statePath: string;
  let dependencies: HerdrAdapterDependencies;
  let exit: MockExit | undefined;

  function adapterEnvironment(): NodeJS.ProcessEnv {
    if (!dependencies.environment) {
      throw new Error('Missing Herdr adapter environment');
    }
    return dependencies.environment;
  }

  async function openManagedWorkspace(
    managedTarget: ManagedWorkspaceTarget,
    options: { focus: boolean; provider?: 'tmux' | 'herdr' }
  ): Promise<void> {
    await openWithHerdr(managedTarget, options.focus, dependencies);
  }

  async function planManagedWorkspaceClosure(
    targets: ManagedWorkspaceTarget[],
    focus: ClosureFocusIntent,
    options: ClosurePlanOptions = {}
  ) {
    return planHerdrClosure(targets, focus, options, dependencies);
  }

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await mkdir(targetPath, { recursive: true });
    await mkdir(otherPath, { recursive: true });
    await mkdir(unrelatedPath, { recursive: true });
    const fake = await createFakeHerdr(fakeDir);
    statePath = fake.statePath;
    dependencies = {
      binary: fake.binary,
      environment: {
        ...process.env,
        HERDR_ENV: '1',
        HERDR_BIN_PATH: fake.binary,
        HERDR_SOCKET_PATH: join(testDir, 'test.sock'),
        HERDR_SESSION: 'repos-test-herdr-adapter',
        FAKE_HERDR_STATE: statePath,
        FAKE_HERDR_SERVER_SOCKET: fake.serverSocketPath,
        FAKE_HERDR_SERVER_READY: fake.serverReadyPath,
        TMUX: '/tmp/fake-tmux',
      },
    };
  });

  afterEach(async () => {
    exit?.mockRestore();
    exit = undefined;
    process.chdir(import.meta.dir.replace('/tests', ''));
    await rm(testDir, { recursive: true, force: true });
  });

  test('opens and reuses a canonical Managed Workspace without changing focus', async () => {
    await openManagedWorkspace(target, { focus: false, provider: 'tmux' });
    await openManagedWorkspace(target, { focus: false, provider: 'tmux' });

    const state = await readFakeHerdrState(statePath);
    expect(state.workspaces).toEqual([
      workspace('w1', 'repo@feature-one', targetPath, targetPath),
    ]);
    expect(state.calls.map((call) => call.args)).toEqual([
      ['workspace', 'list'],
      ['worktree', 'list', '--cwd', targetPath],
      ['worktree', 'list', '--cwd', targetPath],
      [
        'worktree',
        'open',
        '--cwd',
        targetPath,
        '--path',
        targetPath,
        '--label',
        'repo@feature-one',
        '--no-focus',
      ],
      ['workspace', 'list'],
    ]);
    expect(state.calls[0]?.environment).toEqual({
      HERDR_ENV: '1',
      HERDR_SOCKET_PATH: join(testDir, 'test.sock'),
      HERDR_SESSION: 'repos-test-herdr-adapter',
      HERDR_WORKSPACE_ID: undefined,
      HERDR_BIN_PATH: join(fakeDir, 'herdr'),
    });
  });

  test('uses the worktree path to disambiguate normalized label collisions', async () => {
    const initial = await createFakeHerdr(fakeDir, {
      nextId: 3,
      workspaces: [
        workspace('w1', 'repo@feature-one', otherPath),
        workspace('w2', 'repo@feature-one', targetPath),
      ],
    });
    statePath = initial.statePath;
    adapterEnvironment().FAKE_HERDR_STATE = statePath;

    await openManagedWorkspace(target, { focus: true, provider: 'herdr' });

    const state = await readFakeHerdrState(statePath);
    expect(state.workspaces).toEqual([
      workspace('w1', 'repo@feature-one', otherPath),
      {
        ...workspace('w2', collisionSafeTargetName, targetPath),
        focused: true,
      },
    ]);
    expect(state.calls.map((call) => call.args)).toEqual([
      ['workspace', 'list'],
      ['workspace', 'rename', 'w2', collisionSafeTargetName],
      ['workspace', 'focus', 'w2'],
    ]);

    const plan = await planManagedWorkspaceClosure(
      [target],
      { kind: 'preserve', destination: { path: otherPath } },
      { provider: 'herdr' }
    );
    await plan.execute();

    expect((await readFakeHerdrState(statePath)).workspaces).toEqual([
      workspace('w1', 'repo@feature-one', otherPath),
    ]);
  });

  test('opens a worktree instead of reusing a colliding normalized label', async () => {
    const initial = await createFakeHerdr(fakeDir, {
      nextId: 2,
      workspaces: [workspace('w1', 'repo@feature-one', otherPath)],
    });
    statePath = initial.statePath;
    adapterEnvironment().FAKE_HERDR_STATE = statePath;

    await openManagedWorkspace(target, { focus: false, provider: 'herdr' });
    await openManagedWorkspace(target, { focus: false, provider: 'herdr' });

    const state = await readFakeHerdrState(statePath);
    expect(state.workspaces).toEqual([
      workspace('w1', 'repo@feature-one', otherPath),
      workspace('w2', collisionSafeTargetName, targetPath, targetPath),
    ]);
    expect(state.calls.map((call) => call.args)).toEqual([
      ['workspace', 'list'],
      ['worktree', 'list', '--cwd', targetPath],
      ['worktree', 'list', '--cwd', targetPath],
      [
        'worktree',
        'open',
        '--cwd',
        targetPath,
        '--path',
        targetPath,
        '--label',
        collisionSafeTargetName,
        '--no-focus',
      ],
      ['workspace', 'list'],
      ['worktree', 'list', '--cwd', targetPath],
    ]);
  });

  test('does not close an unassociated workspace with a colliding label', async () => {
    const colliding = workspace('w1', 'repo@feature-one', otherPath);
    delete colliding.worktree;
    const initial = await createFakeHerdr(fakeDir, {
      nextId: 2,
      workspaces: [colliding],
    });
    statePath = initial.statePath;
    adapterEnvironment().FAKE_HERDR_STATE = statePath;

    const plan = await planManagedWorkspaceClosure(
      [target],
      { kind: 'preserve', destination: { path: otherPath } },
      { provider: 'herdr' }
    );
    await plan.execute();

    const state = await readFakeHerdrState(statePath);
    expect(state.workspaces).toEqual([colliding]);
    expect(state.calls.map((call) => call.args)).toEqual([
      ['workspace', 'list'],
      ['status', 'server', '--json'],
      ['workspace', 'list'],
      ['worktree', 'list', '--cwd', targetPath],
      ['status', 'server', '--json'],
    ]);
  });

  test('focuses through the current Herdr socket context', async () => {
    await openManagedWorkspace(target, { focus: false, provider: 'herdr' });
    await openManagedWorkspace(target, { focus: true, provider: 'herdr' });

    const state = await readFakeHerdrState(statePath);
    expect(state.workspaces[0]?.focused).toBe(true);
    expect(state.calls.map((call) => call.args).slice(-2)).toEqual([
      ['workspace', 'list'],
      ['workspace', 'focus', 'w1'],
    ]);
  });

  test('starts the default Herdr server for no-focus work outside Herdr', async () => {
    const fake = await createFakeHerdr(fakeDir, { running: false });
    statePath = fake.statePath;
    dependencies = {
      binary: fake.binary,
      environment: {
        ...process.env,
        FAKE_HERDR_STATE: statePath,
        FAKE_HERDR_SERVER_SOCKET: fake.serverSocketPath,
        FAKE_HERDR_SERVER_READY: fake.serverReadyPath,
      },
    };

    await openManagedWorkspace(target, { focus: false, provider: 'herdr' });

    const state = await readFakeHerdrState(statePath);
    expect(state.running).toBe(true);
    expect(state.calls[0]?.args).toEqual(['workspace', 'list']);
    expect(
      state.calls
        .map((call) => call.args)
        .filter((args) => args[0] === 'worktree' && args[1] === 'open')
    ).toEqual([
      [
        'worktree',
        'open',
        '--cwd',
        targetPath,
        '--path',
        targetPath,
        '--label',
        'repo@feature-one',
        '--no-focus',
      ],
    ]);
  });

  test('uses the default server namespace outside Herdr', async () => {
    const environment = adapterEnvironment();
    environment.HERDR_ENV = undefined;
    environment.TMUX = undefined;

    await openManagedWorkspace(target, { focus: false, provider: 'herdr' });

    const state = await readFakeHerdrState(statePath);
    expect(state.calls[0]?.environment).toEqual({
      HERDR_ENV: undefined,
      HERDR_SOCKET_PATH: undefined,
      HERDR_SESSION: undefined,
      HERDR_WORKSPACE_ID: undefined,
      HERDR_BIN_PATH: undefined,
    });
  });

  test('focuses and attaches the full client outside Herdr', async () => {
    const environment = adapterEnvironment();
    environment.HERDR_ENV = undefined;
    environment.TMUX = undefined;

    await openManagedWorkspace(target, { focus: true, provider: 'herdr' });

    const state = await readFakeHerdrState(statePath);
    expect(state.workspaces[0]?.focused).toBe(true);
    expect(state.calls.map((call) => call.args).slice(-2)).toEqual([
      ['workspace', 'focus', 'w1'],
      [],
    ]);
  });

  test('previews and executes an automatic batch closure without changing focus', async () => {
    const other = {
      repoName: 'repo',
      branch: 'other',
      worktreePath: otherPath,
    };
    const unrelated = {
      repoName: 'repo',
      branch: 'unrelated',
      worktreePath: unrelatedPath,
    };
    await openManagedWorkspace(target, { focus: false, provider: 'herdr' });
    await openManagedWorkspace(other, { focus: false, provider: 'herdr' });
    await openManagedWorkspace(unrelated, { focus: false, provider: 'herdr' });
    adapterEnvironment().HERDR_WORKSPACE_ID = 'w1';
    const plan = await planManagedWorkspaceClosure(
      [target, other],
      { kind: 'automatic', candidates: [] },
      { provider: 'herdr' }
    );
    const capture = captureStream(process.stdout);

    await plan.preview();
    await rm(targetPath, { recursive: true });
    await rm(otherPath, { recursive: true });
    await plan.execute();
    capture.restore();

    const state = await readFakeHerdrState(statePath);
    expect(capture.output).toEqual([
      'Would close Herdr workspace "repo@feature-one"\n',
      'Would close Herdr workspace "repo@other"\n',
      'Closed Herdr workspace "repo@other"\n',
      'Closed Herdr workspace "repo@feature-one"\n',
    ]);
    expect(state.workspaces).toEqual([
      workspace('w3', 'repo@unrelated', unrelatedPath, unrelatedPath),
    ]);
    expect(state.calls.map((call) => call.args).slice(-4)).toEqual([
      ['status', 'server', '--json'],
      ['workspace', 'close', 'w2'],
      ['status', 'server', '--json'],
      ['workspace', 'close', 'w1'],
    ]);
  });

  test('focuses the logical destination before closing a workspace', async () => {
    await openManagedWorkspace(target, { focus: false, provider: 'herdr' });
    const destination = {
      repoName: 'repo',
      branch: 'other',
      worktreePath: otherPath,
    };
    const plan = await planManagedWorkspaceClosure(
      [target],
      { kind: 'destination', target: destination },
      { provider: 'herdr' }
    );

    await rm(targetPath, { recursive: true });
    await plan.execute();

    const state = await readFakeHerdrState(statePath);
    expect(state.workspaces).toEqual([
      workspace('w2', 'repo@other', otherPath, otherPath, true),
    ]);
    expect(state.workspaces[0]?.focused).toBe(true);
    const actions = state.calls.map((call) => call.args);
    expect(actions.slice(-3)).toEqual([
      ['workspace', 'focus', 'w2'],
      ['status', 'server', '--json'],
      ['workspace', 'close', 'w1'],
    ]);
  });

  test('does not close a reused workspace ID after a server restart', async () => {
    await openManagedWorkspace(target, { focus: false, provider: 'herdr' });
    const plan = await planManagedWorkspaceClosure(
      [target],
      { kind: 'preserve', destination: { path: otherPath } },
      { provider: 'herdr' }
    );
    const capture = captureStream(process.stderr);
    const serverSocketPath = adapterEnvironment().FAKE_HERDR_SERVER_SOCKET;
    if (!serverSocketPath) throw new Error('Missing fake server socket');
    await rm(serverSocketPath, { force: true });
    await Bun.sleep(5);
    await Bun.write(serverSocketPath, 'replacement server socket');

    await plan.execute();
    capture.restore();

    expect(capture.output).toEqual([
      'Warning: no Herdr workspaces were closed because the Herdr server restarted\n',
    ]);
    expect((await readFakeHerdrState(statePath)).workspaces).toEqual([
      workspace('w1', 'repo@feature-one', targetPath, targetPath),
    ]);
  });

  test('rejects active no-focus closure before mutation', async () => {
    await openManagedWorkspace(target, { focus: false, provider: 'herdr' });
    adapterEnvironment().HERDR_WORKSPACE_ID = 'w1';
    exit = mockProcessExit();

    await expect(
      planManagedWorkspaceClosure(
        [target],
        { kind: 'preserve', destination: { path: otherPath } },
        { provider: 'herdr' }
      )
    ).rejects.toThrow('process.exit(1)');

    expect((await readFakeHerdrState(statePath)).workspaces).toEqual([
      workspace('w1', 'repo@feature-one', targetPath, targetPath),
    ]);
  });

  test('reports provider failures without falling back to tmux', async () => {
    const fake = await createFakeHerdr(fakeDir, {
      failure: {
        command: 'workspace list',
        code: 'permission_denied',
        message: 'cannot inspect Herdr workspaces',
      },
    });
    statePath = fake.statePath;
    adapterEnvironment().FAKE_HERDR_STATE = statePath;
    exit = mockProcessExit();
    const capture = captureStream(process.stderr);

    await expect(
      openManagedWorkspace(target, { focus: false, provider: 'herdr' })
    ).rejects.toThrow('process.exit(1)');
    capture.restore();

    expect(capture.output).toEqual([
      'Error: cannot inspect Herdr workspaces\n',
    ]);
    expect((await readFakeHerdrState(statePath)).calls).toHaveLength(1);
  });
});
