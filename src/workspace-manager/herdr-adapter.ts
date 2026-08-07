import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { print, printError, printStatus } from '../output.ts';
import type { OperationResult } from '../types.ts';
import type {
  ClosureFocusIntent,
  ClosurePlanOptions,
  ManagedWorkspaceClosurePlan,
  ManagedWorkspaceTarget,
} from './index.ts';
import { getManagedWorkspaceName } from './name.ts';

type HerdrWorkspace = {
  workspace_id: string;
  label: string;
  focused: boolean;
  worktree?: { checkout_path: string };
};

type HerdrWorktree = {
  path: string;
  is_bare: boolean;
  open_workspace_id?: string;
};

type HerdrCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type HerdrCommandContext = {
  binary: string;
  environment: Record<string, string>;
  insideHerdr: boolean;
};

export type HerdrAdapterDependencies = {
  binary?: string;
  environment?: NodeJS.ProcessEnv;
};

type WorkspaceListResult = {
  type: 'workspace_list';
  workspaces: HerdrWorkspace[];
};

type WorktreeListResult = {
  type: 'worktree_list';
  source: { repo_root: string };
  worktrees: HerdrWorktree[];
};

type WorktreeOpenedResult = {
  type: 'worktree_opened';
  workspace: HerdrWorkspace;
  already_open: boolean;
};

type WorkspaceCreatedResult = {
  type: 'workspace_created';
  workspace: HerdrWorkspace;
};

type PlannedClosure = {
  workspaceId: string;
  label: string;
  targets: ManagedWorkspaceTarget[];
};

type HerdrServerIdentity = {
  socket: string;
  device: number;
  inode: number;
  changedAt: number;
};

const SERVER_READY_ATTEMPTS = 300;
const SERVER_READY_INTERVAL_MS = 50;
const HERDR_ENVIRONMENT_KEYS = [
  'HERDR_ENV',
  'HERDR_SOCKET_PATH',
  'HERDR_CLIENT_SOCKET_PATH',
  'HERDR_SESSION',
  'HERDR_WORKSPACE_ID',
  'HERDR_TAB_ID',
  'HERDR_PANE_ID',
  'HERDR_BIN_PATH',
];

function commandContext(
  dependencies: HerdrAdapterDependencies = {}
): HerdrCommandContext {
  const sourceEnvironment = dependencies.environment ?? process.env;
  const insideHerdr = sourceEnvironment.HERDR_ENV === '1';
  const requestedBinary =
    dependencies.binary ??
    (insideHerdr && sourceEnvironment.HERDR_BIN_PATH
      ? sourceEnvironment.HERDR_BIN_PATH
      : 'herdr');
  const binary =
    Bun.which(requestedBinary, { PATH: sourceEnvironment.PATH }) ??
    requestedBinary;
  const environment = Object.fromEntries(
    Object.entries(sourceEnvironment).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        (insideHerdr || !HERDR_ENVIRONMENT_KEYS.includes(entry[0]))
    )
  );

  return { binary, environment, insideHerdr };
}

async function runHerdrCommand(
  context: HerdrCommandContext,
  args: string[],
  options: { inheritStdio?: boolean } = {}
): Promise<HerdrCommandResult> {
  if (options.inheritStdio) {
    const proc = Bun.spawn([context.binary, ...args], {
      env: context.environment,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    return { stdout: '', stderr: '', exitCode: await proc.exited };
  }

  const proc = Bun.spawn([context.binary, ...args], {
    env: context.environment,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHerdrWorkspace(value: unknown): value is HerdrWorkspace {
  return (
    isRecord(value) &&
    typeof value.workspace_id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.focused === 'boolean' &&
    (value.worktree === undefined ||
      (isRecord(value.worktree) &&
        typeof value.worktree.checkout_path === 'string'))
  );
}

function isWorkspaceListResult(value: unknown): value is WorkspaceListResult {
  return (
    isRecord(value) &&
    value.type === 'workspace_list' &&
    Array.isArray(value.workspaces) &&
    value.workspaces.every(isHerdrWorkspace)
  );
}

function isHerdrWorktree(value: unknown): value is HerdrWorktree {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    typeof value.is_bare === 'boolean' &&
    (value.open_workspace_id === undefined ||
      typeof value.open_workspace_id === 'string')
  );
}

function isWorktreeListResult(value: unknown): value is WorktreeListResult {
  return (
    isRecord(value) &&
    value.type === 'worktree_list' &&
    isRecord(value.source) &&
    typeof value.source.repo_root === 'string' &&
    Array.isArray(value.worktrees) &&
    value.worktrees.every(isHerdrWorktree)
  );
}

function isWorktreeOpenedResult(value: unknown): value is WorktreeOpenedResult {
  return (
    isRecord(value) &&
    value.type === 'worktree_opened' &&
    isHerdrWorkspace(value.workspace) &&
    typeof value.already_open === 'boolean'
  );
}

function isWorkspaceCreatedResult(
  value: unknown
): value is WorkspaceCreatedResult {
  return (
    isRecord(value) &&
    value.type === 'workspace_created' &&
    isHerdrWorkspace(value.workspace)
  );
}

function isServerStatus(value: unknown): value is { socket: string } {
  return (
    isRecord(value) &&
    value.status === 'running' &&
    typeof value.socket === 'string'
  );
}

function parseJson(value: string): OperationResult<unknown> {
  try {
    const data: unknown = JSON.parse(value);
    return { success: true, data };
  } catch {
    return { success: false, error: 'invalid JSON' };
  }
}

function parseHerdrError(result: HerdrCommandResult): {
  code?: string;
  message: string;
} {
  const parsed = parseJson(result.stderr);
  if (parsed.success && isRecord(parsed.data) && isRecord(parsed.data.error)) {
    const code = parsed.data.error.code;
    const message = parsed.data.error.message;
    if (typeof message === 'string') {
      return {
        code: typeof code === 'string' ? code : undefined,
        message,
      };
    }
  }
  return {
    message: result.stderr || result.stdout || 'Herdr command failed',
  };
}

async function safelyRunHerdrCommand(
  context: HerdrCommandContext,
  args: string[]
): Promise<OperationResult<HerdrCommandResult>> {
  try {
    return {
      success: true,
      data: await runHerdrCommand(context, args),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run Herdr',
    };
  }
}

async function runHerdrJson<T>(
  context: HerdrCommandContext,
  args: string[],
  isExpected: (value: unknown) => value is T
): Promise<OperationResult<T> & { code?: string }> {
  const command = await safelyRunHerdrCommand(context, args);
  if (!command.success) return command;

  if (command.data.exitCode !== 0) {
    const error = parseHerdrError(command.data);
    return { success: false, error: error.message, code: error.code };
  }

  const response = parseJson(command.data.stdout);
  if (
    !response.success ||
    !isRecord(response.data) ||
    !isExpected(response.data.result)
  ) {
    return { success: false, error: 'Herdr returned invalid JSON' };
  }
  return { success: true, data: response.data.result };
}

async function readServerIdentity(
  context: HerdrCommandContext
): Promise<OperationResult<HerdrServerIdentity>> {
  const command = await safelyRunHerdrCommand(context, [
    'status',
    'server',
    '--json',
  ]);
  if (!command.success) return command;
  if (command.data.exitCode !== 0) {
    const error = parseHerdrError(command.data);
    return { success: false, error: error.message };
  }

  const response = parseJson(command.data.stdout);
  if (!response.success || !isServerStatus(response.data)) {
    return { success: false, error: 'Herdr returned invalid server status' };
  }

  try {
    const socket = await stat(response.data.socket);
    return {
      success: true,
      data: {
        socket: response.data.socket,
        device: socket.dev,
        inode: socket.ino,
        changedAt: socket.ctimeMs,
      },
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? `Cannot inspect the Herdr server socket: ${error.message}`
          : 'Cannot inspect the Herdr server socket',
    };
  }
}

function sameServer(
  planned: HerdrServerIdentity,
  current: HerdrServerIdentity
): boolean {
  return (
    planned.socket === current.socket &&
    planned.device === current.device &&
    planned.inode === current.inode &&
    planned.changedAt === current.changedAt
  );
}

async function verifyServerIdentity(
  context: HerdrCommandContext,
  planned: HerdrServerIdentity
): Promise<boolean> {
  const current = await readServerIdentity(context);
  if (current.success && sameServer(planned, current.data)) return true;

  const reason = current.success ? 'the Herdr server restarted' : current.error;
  printError(`Warning: no Herdr workspaces were closed because ${reason}`);
  return false;
}

function fail(message: string): never {
  printError(`Error: ${message}`);
  process.exit(1);
}

function isServerNotRunning(result: {
  success: false;
  code?: string;
}): boolean {
  return result.code === 'server_not_running';
}

function spawnHerdrServer(context: HerdrCommandContext): OperationResult {
  try {
    const server = Bun.spawn([context.binary, 'server'], {
      env: context.environment,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    server.unref();
    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? `Failed to start Herdr server: ${error.message}`
          : 'Failed to start Herdr server',
    };
  }
}

async function startHerdrServer(
  context: HerdrCommandContext
): Promise<OperationResult> {
  const spawned = spawnHerdrServer(context);
  if (!spawned.success) return spawned;

  for (let attempt = 0; attempt < SERVER_READY_ATTEMPTS; attempt += 1) {
    const listed = await runHerdrJson(
      context,
      ['workspace', 'list'],
      isWorkspaceListResult
    );
    if (listed.success) return { success: true, data: undefined };
    if (!isServerNotRunning(listed)) return listed;
    await Bun.sleep(SERVER_READY_INTERVAL_MS);
  }

  return {
    success: false,
    error: 'Herdr server did not become ready within 15 seconds',
  };
}

async function listWorkspaces(
  context: HerdrCommandContext,
  options: { startServer: boolean }
): Promise<OperationResult<HerdrWorkspace[]>> {
  let result = await runHerdrJson(
    context,
    ['workspace', 'list'],
    isWorkspaceListResult
  );
  if (!result.success && isServerNotRunning(result) && options.startServer) {
    const started = await startHerdrServer(context);
    if (!started.success) return started;
    result = await runHerdrJson(
      context,
      ['workspace', 'list'],
      isWorkspaceListResult
    );
  }
  if (!result.success) return result;
  return { success: true, data: result.data.workspaces };
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function listWorktrees(
  context: HerdrCommandContext,
  worktreePath: string
): Promise<OperationResult<WorktreeListResult>> {
  return runHerdrJson(
    context,
    ['worktree', 'list', '--cwd', worktreePath],
    isWorktreeListResult
  );
}

async function matchWorkspace(
  context: HerdrCommandContext,
  workspaces: HerdrWorkspace[],
  target: ManagedWorkspaceTarget,
  excludedWorkspaceIds = new Set<string>()
): Promise<OperationResult<HerdrWorkspace | null>> {
  const availableWorkspaces = workspaces.filter(
    (workspace) => !excludedWorkspaceIds.has(workspace.workspace_id)
  );
  const name = getManagedWorkspaceName(target.repoName, target.branch);
  const named = availableWorkspaces.find(
    (workspace) => workspace.label === name
  );
  if (named) return { success: true, data: named };

  const targetPath = await canonicalPath(target.worktreePath);
  const worktreeResult = await listWorktrees(context, target.worktreePath);
  if (!worktreeResult.success) return worktreeResult;

  for (const worktree of worktreeResult.data.worktrees) {
    if (
      worktree.open_workspace_id &&
      (await canonicalPath(worktree.path)) === targetPath
    ) {
      const matched = availableWorkspaces.find(
        (workspace) => workspace.workspace_id === worktree.open_workspace_id
      );
      if (matched) return { success: true, data: matched };
    }
  }

  for (const workspace of availableWorkspaces) {
    if (
      workspace.worktree &&
      (await canonicalPath(workspace.worktree.checkout_path)) === targetPath
    ) {
      return { success: true, data: workspace };
    }
  }

  return { success: true, data: null };
}

async function ensureWorkspace(
  context: HerdrCommandContext,
  target: ManagedWorkspaceTarget,
  excludedWorkspaceIds = new Set<string>()
): Promise<{ workspace: HerdrWorkspace; existed: boolean }> {
  const listed = await listWorkspaces(context, { startServer: true });
  if (!listed.success) fail(listed.error);

  const name = getManagedWorkspaceName(target.repoName, target.branch);
  const matched = await matchWorkspace(
    context,
    listed.data,
    target,
    excludedWorkspaceIds
  );
  if (!matched.success) fail(matched.error);
  if (matched.data) {
    if (matched.data.label !== name) {
      const renamed = await runHerdrJson(
        context,
        ['workspace', 'rename', matched.data.workspace_id, name],
        isRecord
      );
      if (!renamed.success) fail(renamed.error);
    }
    return {
      workspace: { ...matched.data, label: name },
      existed: true,
    };
  }

  const worktrees = await listWorktrees(context, target.worktreePath);
  if (!worktrees.success) fail(worktrees.error);
  const targetPath = await canonicalPath(target.worktreePath);
  const worktreePaths = await Promise.all(
    worktrees.data.worktrees.map(async (worktree) => ({
      worktree,
      path: await canonicalPath(worktree.path),
    }))
  );
  const targetWorktree = worktreePaths.find(
    (entry) => entry.path === targetPath
  )?.worktree;

  if (targetWorktree?.is_bare) {
    const created = await runHerdrJson(
      context,
      [
        'workspace',
        'create',
        '--cwd',
        target.worktreePath,
        '--label',
        name,
        '--no-focus',
      ],
      isWorkspaceCreatedResult
    );
    if (!created.success) fail(created.error);
    printStatus(`Opened Herdr workspace "${name}"`);
    return { workspace: created.data.workspace, existed: false };
  }

  const opened = await runHerdrJson(
    context,
    [
      'worktree',
      'open',
      '--cwd',
      worktrees.data.source.repo_root,
      '--path',
      target.worktreePath,
      '--label',
      name,
      '--no-focus',
    ],
    isWorktreeOpenedResult
  );
  if (!opened.success) fail(opened.error);
  printStatus(`Opened Herdr workspace "${name}"`);
  return {
    workspace: opened.data.workspace,
    existed: opened.data.already_open,
  };
}

async function focusWorkspace(
  context: HerdrCommandContext,
  workspace: HerdrWorkspace
): Promise<void> {
  const focused = await runHerdrJson(
    context,
    ['workspace', 'focus', workspace.workspace_id],
    isRecord
  );
  if (!focused.success) fail(focused.error);
}

async function attachHerdr(context: HerdrCommandContext): Promise<void> {
  const attached = await runHerdrCommand(context, [], { inheritStdio: true });
  if (attached.exitCode !== 0) {
    fail('Failed to attach the Herdr client');
  }
}

export async function openWithHerdr(
  target: ManagedWorkspaceTarget,
  focus: boolean,
  dependencies: HerdrAdapterDependencies = {}
): Promise<void> {
  const context = commandContext(dependencies);
  const managed = await ensureWorkspace(context, target);
  if (!focus) return;

  if (managed.existed) {
    printStatus(
      `Attaching to existing Herdr workspace "${managed.workspace.label}"`
    );
  }
  await focusWorkspace(context, managed.workspace);
  if (!context.insideHerdr) await attachHerdr(context);
}

async function discoverClosures(
  context: HerdrCommandContext,
  targets: ManagedWorkspaceTarget[]
): Promise<{
  closures: PlannedClosure[];
  serverIdentity: HerdrServerIdentity | null;
}> {
  const preflight = await listWorkspaces(context, { startServer: false });
  if (!preflight.success) {
    if (isServerNotRunning(preflight)) {
      return { closures: [], serverIdentity: null };
    }
    fail(preflight.error);
  }

  const identityBefore = await readServerIdentity(context);
  if (!identityBefore.success) fail(identityBefore.error);
  const listed = await listWorkspaces(context, { startServer: false });
  if (!listed.success) fail(listed.error);

  const closures: PlannedClosure[] = [];
  for (const target of targets) {
    const matched = await matchWorkspace(context, listed.data, target);
    if (!matched.success) fail(matched.error);
    if (matched.data) {
      const existing = closures.find(
        (closure) => closure.workspaceId === matched.data?.workspace_id
      );
      if (existing) {
        existing.targets.push(target);
      } else {
        closures.push({
          workspaceId: matched.data.workspace_id,
          label: matched.data.label,
          targets: [target],
        });
      }
    }
  }

  const identityAfter = await readServerIdentity(context);
  if (!identityAfter.success) fail(identityAfter.error);
  if (!sameServer(identityBefore.data, identityAfter.data)) {
    fail('The Herdr server restarted while planning workspace closure');
  }
  return { closures, serverIdentity: identityAfter.data };
}

async function closeWorkspace(
  context: HerdrCommandContext,
  closure: PlannedClosure
): Promise<boolean> {
  const closed = await runHerdrJson(
    context,
    ['workspace', 'close', closure.workspaceId],
    isRecord
  );
  if (!closed.success) {
    printError(
      `Warning: Failed to close Herdr workspace "${closure.label}": ${closed.error}`
    );
    return false;
  }
  return true;
}

export async function planHerdrClosure(
  targets: ManagedWorkspaceTarget[],
  focus: ClosureFocusIntent,
  options: ClosurePlanOptions = {},
  dependencies: HerdrAdapterDependencies = {}
): Promise<ManagedWorkspaceClosurePlan> {
  const context = commandContext(dependencies);
  const discovery = await discoverClosures(context, targets);
  const { closures } = discovery;
  const plannedServerIdentity = discovery.serverIdentity;
  const currentWorkspaceId = context.insideHerdr
    ? context.environment.HERDR_WORKSPACE_ID
    : undefined;

  if (
    options.mode !== 'preview' &&
    focus.kind === 'preserve' &&
    currentWorkspaceId &&
    closures.some((closure) => closure.workspaceId === currentWorkspaceId)
  ) {
    const active = closures.find(
      (closure) => closure.workspaceId === currentWorkspaceId
    );
    fail(
      `Cannot clean the active Herdr workspace "${active?.label ?? currentWorkspaceId}" with --no-focus.`
    );
  }

  return {
    async preview(): Promise<void> {
      for (const closure of closures) {
        print(`Would close Herdr workspace "${closure.label}"`);
      }
    },

    async execute(completedTargets): Promise<void> {
      if (options.mode === 'preview') {
        fail('Cannot execute a preview-only Workspace Manager plan');
      }

      const executingClosures = closures.filter(
        (closure) =>
          completedTargets === undefined ||
          closure.targets.some((target) =>
            completedTargets.some(
              (completed) =>
                completed.repoName === target.repoName &&
                completed.branch === target.branch &&
                completed.worktreePath === target.worktreePath
            )
          )
      );
      const orderedClosures =
        focus.kind === 'automatic' && currentWorkspaceId
          ? [
              ...executingClosures.filter(
                (closure) => closure.workspaceId !== currentWorkspaceId
              ),
              ...executingClosures.filter(
                (closure) => closure.workspaceId === currentWorkspaceId
              ),
            ]
          : executingClosures;

      const workingDirectory =
        focus.kind === 'preserve'
          ? focus.destination.path
          : focus.kind === 'destination'
            ? focus.target.worktreePath
            : focus.candidates[0]?.worktreePath;
      if (workingDirectory) process.chdir(workingDirectory);

      if (
        focus.kind === 'destination' &&
        executingClosures.length > 0 &&
        plannedServerIdentity &&
        !(await verifyServerIdentity(context, plannedServerIdentity))
      ) {
        return;
      }

      if (focus.kind === 'destination') {
        const destination = await ensureWorkspace(
          context,
          focus.target,
          new Set(executingClosures.map((closure) => closure.workspaceId))
        );
        if (destination.existed) {
          printStatus(
            `Attaching to existing Herdr workspace "${destination.workspace.label}"`
          );
        }
        await focusWorkspace(context, destination.workspace);
      }

      for (const closure of orderedClosures) {
        if (
          plannedServerIdentity &&
          !(await verifyServerIdentity(context, plannedServerIdentity))
        ) {
          return;
        }
        const closed = await closeWorkspace(context, closure);
        if (closed && focus.kind === 'automatic') {
          print(`Closed Herdr workspace "${closure.label}"`);
        }
      }

      if (focus.kind === 'destination' && !context.insideHerdr) {
        await attachHerdr(context);
      }
    },
  };
}
