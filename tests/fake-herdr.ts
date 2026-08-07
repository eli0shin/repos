import { chmod, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export type FakeHerdrWorkspace = {
  workspace_id: string;
  label: string;
  focused: boolean;
  pane_count: number;
  tab_count: number;
  active_tab_id: string;
  agent_status: string;
  worktree?: {
    repo_key: string;
    repo_name: string;
    repo_root: string;
    checkout_path: string;
    is_linked_worktree: boolean;
  };
};

export type FakeHerdrState = {
  running: boolean;
  nextId: number;
  workspaces: FakeHerdrWorkspace[];
  calls: {
    args: string[];
    environment: Record<string, string | undefined>;
  }[];
  failure?: { command: string; code: string; message: string };
  barePaths?: string[];
  mainPaths?: string[];
  bareOpenWorkspaceIds?: Record<string, string>;
  paneCwds?: Record<string, string>;
};

const FAKE_HERDR_SOURCE = String.raw`#!/usr/bin/env bun
const statePath = process.env.FAKE_HERDR_STATE;
if (!statePath) process.exit(2);
const args = process.argv.slice(2);
const file = Bun.file(statePath);
const state = await file.json();
if (
  process.env.FAKE_HERDR_SERVER_READY &&
  await Bun.file(process.env.FAKE_HERDR_SERVER_READY).exists()
) {
  state.running = true;
}
const command = args.join(' ');
state.calls.push({
  args,
  environment: {
    HERDR_ENV: process.env.HERDR_ENV,
    HERDR_SOCKET_PATH: process.env.HERDR_SOCKET_PATH,
    HERDR_SESSION: process.env.HERDR_SESSION,
    HERDR_WORKSPACE_ID: process.env.HERDR_WORKSPACE_ID,
    HERDR_BIN_PATH: process.env.HERDR_BIN_PATH,
  },
});
const save = async () => Bun.write(statePath, JSON.stringify(state));
const success = async (result) => {
  await save();
  console.log(JSON.stringify({ id: 'fake', result }));
};
const failure = async (code, message) => {
  await save();
  console.error(JSON.stringify({ id: 'fake', error: { code, message } }));
  process.exit(1);
};
const valueAfter = (name) => args[args.indexOf(name) + 1];

if (state.failure && command.startsWith(state.failure.command)) {
  await failure(state.failure.code, state.failure.message);
}
if (args[0] === 'server') {
  state.running = true;
  if (process.env.FAKE_HERDR_SERVER_READY) {
    await Bun.write(process.env.FAKE_HERDR_SERVER_READY, 'ready');
  }
  await save();
  process.exit(0);
}
if (!state.running) await failure('server_not_running', 'Herdr server is not running');
if (args[0] === 'status' && args[1] === 'server' && args[2] === '--json') {
  await save();
  console.log(JSON.stringify({
    status: 'running',
    running: true,
    socket: process.env.FAKE_HERDR_SERVER_SOCKET,
  }));
  process.exit(0);
}
if (args.length === 0) {
  await save();
  process.exit(0);
}
if (args[0] === 'workspace' && args[1] === 'list') {
  await success({ type: 'workspace_list', workspaces: state.workspaces });
} else if (args[0] === 'worktree' && args[1] === 'list') {
  const cwd = valueAfter('--cwd');
  await success({
    type: 'worktree_list',
    source: {
      repo_key: cwd,
      repo_name: 'repo',
      repo_root: cwd,
      source_checkout_path: cwd,
    },
    worktrees: [
      ...state.workspaces.flatMap((workspace) =>
        workspace.worktree
          ? [{
              path: workspace.worktree.checkout_path,
              branch: 'feature',
              is_bare: false,
              is_detached: false,
              is_prunable: false,
              is_linked_worktree: true,
              open_workspace_id: workspace.workspace_id,
              label: 'repo',
            }]
          : []
      ),
      ...(state.barePaths ?? []).map((path) => ({
        path,
        branch: null,
        is_bare: true,
        is_detached: false,
        is_prunable: false,
        is_linked_worktree: false,
        open_workspace_id: state.bareOpenWorkspaceIds?.[path],
        label: 'repo',
      })),
    ],
  });
} else if (args[0] === 'worktree' && args[1] === 'open') {
  const path = valueAfter('--path');
  const label = valueAfter('--label');
  let workspace = state.workspaces.find(
    (candidate) => candidate.worktree?.checkout_path === path
  );
  const alreadyOpen = Boolean(workspace);
  if (!workspace) {
    const workspaceId = 'w' + state.nextId++;
    workspace = {
      workspace_id: workspaceId,
      label,
      focused: false,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: workspaceId + ':t1',
      agent_status: 'unknown',
      worktree: {
        repo_key: valueAfter('--cwd'),
        repo_name: 'repo',
        repo_root: valueAfter('--cwd'),
        checkout_path: path,
        is_linked_worktree: !state.mainPaths?.includes(path),
      },
    };
    state.workspaces.push(workspace);
  }
  await success({
    type: 'worktree_opened',
    workspace,
    already_open: alreadyOpen,
    worktree: { path, open_workspace_id: workspace.workspace_id },
    tab: {},
    root_pane: {},
  });
} else if (args[0] === 'workspace' && args[1] === 'create') {
  const workspaceId = 'w' + state.nextId++;
  const workspace = {
    workspace_id: workspaceId,
    label: valueAfter('--label'),
    focused: false,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: workspaceId + ':t1',
    agent_status: 'unknown',
  };
  state.workspaces.push(workspace);
  state.paneCwds ??= {};
  state.paneCwds[workspaceId] = valueAfter('--cwd');
  await success({
    type: 'workspace_created',
    workspace,
    tab: {},
    root_pane: { cwd: valueAfter('--cwd') },
  });
} else if (args[0] === 'workspace' && args[1] === 'rename') {
  const workspace = state.workspaces.find(
    (candidate) => candidate.workspace_id === args[2]
  );
  if (!workspace) await failure('workspace_not_found', 'Workspace not found');
  workspace.label = args.slice(3).join(' ');
  await success({ type: 'workspace_info', workspace });
} else if (args[0] === 'workspace' && args[1] === 'focus') {
  const workspace = state.workspaces.find(
    (candidate) => candidate.workspace_id === args[2]
  );
  if (!workspace) await failure('workspace_not_found', 'Workspace not found');
  for (const candidate of state.workspaces) candidate.focused = false;
  workspace.focused = true;
  await success({ type: 'workspace_info', workspace });
} else if (args[0] === 'pane' && args[1] === 'list') {
  const workspaceId = valueAfter('--workspace');
  const cwd = state.paneCwds?.[workspaceId];
  await success({
    type: 'pane_list',
    panes: cwd ? [{ cwd }] : [],
  });
} else if (args[0] === 'workspace' && args[1] === 'close') {
  const index = state.workspaces.findIndex(
    (candidate) => candidate.workspace_id === args[2]
  );
  if (index === -1) await failure('workspace_not_found', 'Workspace not found');
  state.workspaces.splice(index, 1);
  await success({ type: 'ok' });
} else {
  await failure('unsupported', 'Unsupported fake Herdr command: ' + command);
}
`;

export async function createFakeHerdr(
  directory: string,
  initial: Partial<FakeHerdrState> = {}
): Promise<{
  binary: string;
  statePath: string;
  serverSocketPath: string;
  serverReadyPath: string;
}> {
  await mkdir(directory, { recursive: true });
  const binary = join(directory, 'herdr');
  const statePath = join(directory, 'state.json');
  const serverSocketPath = join(directory, 'server.sock');
  const serverReadyPath = join(directory, 'server.ready');
  const state = {
    running: initial.running ?? true,
    nextId: initial.nextId ?? 1,
    workspaces: initial.workspaces ?? [],
    calls: initial.calls ?? [],
    ...(initial.failure ? { failure: initial.failure } : {}),
    ...(initial.barePaths ? { barePaths: initial.barePaths } : {}),
    ...(initial.mainPaths ? { mainPaths: initial.mainPaths } : {}),
    ...(initial.bareOpenWorkspaceIds
      ? { bareOpenWorkspaceIds: initial.bareOpenWorkspaceIds }
      : {}),
    ...(initial.paneCwds ? { paneCwds: initial.paneCwds } : {}),
  } satisfies FakeHerdrState;
  await Bun.write(
    binary,
    FAKE_HERDR_SOURCE.replace('#!/usr/bin/env bun', `#!${process.execPath}`)
  );
  await chmod(binary, 0o755);
  await Bun.write(statePath, JSON.stringify(state));
  await Bun.write(serverSocketPath, 'fake socket');
  if (state.running) await Bun.write(serverReadyPath, 'ready');
  else await rm(serverReadyPath, { force: true });
  return { binary, statePath, serverSocketPath, serverReadyPath };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFakeHerdrWorkspace(value: unknown): value is FakeHerdrWorkspace {
  return (
    isRecord(value) &&
    typeof value.workspace_id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.focused === 'boolean' &&
    typeof value.pane_count === 'number' &&
    typeof value.tab_count === 'number' &&
    typeof value.active_tab_id === 'string' &&
    typeof value.agent_status === 'string'
  );
}

function isFakeHerdrState(value: unknown): value is FakeHerdrState {
  return (
    isRecord(value) &&
    typeof value.running === 'boolean' &&
    typeof value.nextId === 'number' &&
    Array.isArray(value.workspaces) &&
    value.workspaces.every(isFakeHerdrWorkspace) &&
    Array.isArray(value.calls)
  );
}

export async function readFakeHerdrState(
  statePath: string
): Promise<FakeHerdrState> {
  const state: unknown = await Bun.file(statePath).json();
  if (!isFakeHerdrState(state)) throw new Error('Invalid fake Herdr state');
  return state;
}
