import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { print, printError, printStatus } from '../output.ts';
import type { OperationResult } from '../types.ts';
import type {
  ClosureFocusIntent,
  ClosurePlanOptions,
  ManagedWorkspaceClosurePlan,
  ManagedWorkspaceTarget,
} from './index.ts';
import {
  getCollisionSafeManagedWorkspaceName,
  getManagedWorkspaceName,
} from './name.ts';

// A Herdr app space. Its terminals run in herdr-core; the `herdr-app` CLI
// drives the open window that arranges them.
type HerdrAppSpace = {
  id: string;
  name: string;
  folder: string | null;
  terminals: string[];
};

type HerdrAppContext = {
  binary: string;
  environment: Record<string, string>;
  currentTerminal?: string;
};

type CommandResult = { stdout: string; stderr: string; exitCode: number };

type PlannedClosure = {
  spaceId: string;
  name: string;
  targets: ManagedWorkspaceTarget[];
};

export type HerdrAppAdapterDependencies = {
  binary?: string;
  environment?: NodeJS.ProcessEnv;
};

// `herdr-app` exits 2 with this message when no window is open.
const WINDOW_NOT_OPEN = /no Herdr window/;

function commandContext(
  dependencies: HerdrAppAdapterDependencies = {}
): HerdrAppContext {
  const sourceEnvironment = dependencies.environment ?? process.env;
  const requestedBinary = dependencies.binary ?? 'herdr-app';
  const environment = Object.fromEntries(
    Object.entries(sourceEnvironment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
  return {
    binary:
      Bun.which(requestedBinary, { PATH: sourceEnvironment.PATH }) ??
      requestedBinary,
    environment,
    currentTerminal: sourceEnvironment.HC_TERMINAL_ID || undefined,
  };
}

async function runHerdrApp(
  context: HerdrAppContext,
  args: string[]
): Promise<OperationResult<CommandResult>> {
  try {
    const proc = Bun.spawn([context.binary, ...args], {
      env: context.environment,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      success: true,
      data: { stdout: stdout.trim(), stderr: stderr.trim(), exitCode },
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to run the Herdr app',
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseJson(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return undefined;
  }
}

function terminalsOf(space: Record<string, unknown>): string[] {
  if (!Array.isArray(space.tabs)) return [];
  return space.tabs.flatMap((tab) =>
    isRecord(tab) && Array.isArray(tab.terminals)
      ? tab.terminals.flatMap((terminal) =>
          isRecord(terminal) && typeof terminal.terminal === 'string'
            ? [terminal.terminal]
            : []
        )
      : []
  );
}

// herdr-core also runs terminals on machines the app reaches over SSH. Those
// carry the same markers and may have their own `herdr-app`, so only this
// computer's open window showing the terminal makes it a Herdr app terminal.
export function isHerdrAppTerminal(environment: NodeJS.ProcessEnv): boolean {
  const terminal = environment.HC_TERMINAL_ID;
  if (!terminal) return false;
  const binary = Bun.which('herdr-app', { PATH: environment.PATH });
  if (!binary) return false;
  try {
    const listed = Bun.spawnSync([binary, 'ls'], {
      env: commandContext({ environment }).environment,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
    });
    if (listed.exitCode !== 0) return false;
    const parsed = parseJson(listed.stdout.toString());
    return (
      isRecord(parsed) &&
      Array.isArray(parsed.spaces) &&
      parsed.spaces.some(
        (space) =>
          isRecord(space) &&
          !space.machine &&
          terminalsOf(space).includes(terminal)
      )
    );
  } catch {
    return false;
  }
}

function fail(message: string): never {
  printError(`Error: ${message}`);
  process.exit(1);
}

// Lists this computer's spaces. Spaces on other machines hold folders there.
async function listSpaces(
  context: HerdrAppContext
): Promise<OperationResult<HerdrAppSpace[]> & { windowNotOpen?: boolean }> {
  const listed = await runHerdrApp(context, ['ls']);
  if (!listed.success) return listed;
  const { stdout, stderr, exitCode } = listed.data;
  if (exitCode !== 0) {
    return {
      success: false,
      error: stderr || stdout || 'Herdr app command failed',
      windowNotOpen: WINDOW_NOT_OPEN.test(stderr),
    };
  }

  const parsed = parseJson(stdout);
  if (!isRecord(parsed) || !Array.isArray(parsed.spaces)) {
    return { success: false, error: 'Herdr app returned invalid JSON' };
  }
  const spaces: HerdrAppSpace[] = [];
  for (const space of parsed.spaces) {
    if (
      !isRecord(space) ||
      typeof space.id !== 'string' ||
      typeof space.name !== 'string'
    ) {
      return { success: false, error: 'Herdr app returned invalid JSON' };
    }
    if (space.machine) continue;
    spaces.push({
      id: space.id,
      name: space.name,
      folder: typeof space.folder === 'string' ? space.folder : null,
      terminals: terminalsOf(space),
    });
  }
  return { success: true, data: spaces };
}

async function listSpacesOrFail(
  context: HerdrAppContext
): Promise<HerdrAppSpace[]> {
  const listed = await listSpaces(context);
  if (listed.success) return listed.data;
  if (listed.windowNotOpen) {
    fail(`The Herdr app is not open. Open it and retry (${listed.error})`);
  }
  fail(listed.error);
}

// Runs one window command. `do` takes its arguments as one JSON object, so
// values are never parsed as flags.
async function runCommand(
  context: HerdrAppContext,
  command: string,
  args: Record<string, string | boolean>
): Promise<OperationResult<Record<string, unknown>>> {
  const ran = await runHerdrApp(context, ['do', command, JSON.stringify(args)]);
  if (!ran.success) return ran;
  const parsed = parseJson(ran.data.stdout);
  if (ran.data.exitCode !== 0) {
    const error =
      isRecord(parsed) && typeof parsed.error === 'string'
        ? parsed.error
        : ran.data.stderr || ran.data.stdout || 'Herdr app command failed';
    return { success: false, error };
  }
  if (!isRecord(parsed)) {
    return { success: false, error: 'Herdr app returned invalid JSON' };
  }
  return { success: true, data: parsed };
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

// A space belongs to a worktree by its folder. Among several, prefer the one
// repos named, so a space someone opened there by hand is only a fallback.
async function matchSpace(
  spaces: HerdrAppSpace[],
  target: ManagedWorkspaceTarget,
  excludedSpaceIds = new Set<string>()
): Promise<HerdrAppSpace | null> {
  const targetPath = await canonicalPath(target.worktreePath);
  const names = [
    getManagedWorkspaceName(target.repoName, target.branch),
    getCollisionSafeManagedWorkspaceName(target.repoName, target.branch),
  ];
  const candidates: HerdrAppSpace[] = [];
  for (const space of spaces) {
    if (excludedSpaceIds.has(space.id) || !space.folder) continue;
    if ((await canonicalPath(space.folder)) === targetPath) {
      candidates.push(space);
    }
  }
  return (
    candidates.find((space) => names.includes(space.name)) ??
    candidates.at(0) ??
    null
  );
}

async function readFocusedPane(
  context: HerdrAppContext
): Promise<string | undefined> {
  const status = await runHerdrApp(context, ['status']);
  if (!status.success || status.data.exitCode !== 0) return undefined;
  const parsed = parseJson(status.data.stdout);
  return isRecord(parsed) && typeof parsed.focused_pane === 'string'
    ? parsed.focused_pane
    : undefined;
}

async function ensureSpace(
  context: HerdrAppContext,
  target: ManagedWorkspaceTarget,
  options: { keepFocus: boolean; excludedSpaceIds?: Set<string> }
): Promise<{ space: HerdrAppSpace; existed: boolean }> {
  const excluded = options.excludedSpaceIds ?? new Set<string>();
  const spaces = await listSpacesOrFail(context);
  const canonicalName = getManagedWorkspaceName(target.repoName, target.branch);
  const collisionSafeName = getCollisionSafeManagedWorkspaceName(
    target.repoName,
    target.branch
  );
  const matched = await matchSpace(spaces, target, excluded);
  const canonicalTaken = spaces.some(
    (space) =>
      space.name === canonicalName &&
      space.id !== matched?.id &&
      !excluded.has(space.id)
  );
  const name =
    matched?.name === collisionSafeName || canonicalTaken
      ? collisionSafeName
      : canonicalName;

  if (matched) {
    if (matched.name !== name) {
      const renamed = await runCommand(context, 'space.rename', {
        id: matched.id,
        name,
      });
      if (!renamed.success) fail(renamed.error);
    }
    return { space: { ...matched, name }, existed: true };
  }

  // The app shows every new space, so put back the pane that had focus.
  const focusedPane = options.keepFocus
    ? await readFocusedPane(context)
    : undefined;
  const created = await runCommand(context, 'space.new', {
    name,
    folder: target.worktreePath,
  });
  if (!created.success) fail(created.error);
  if (typeof created.data.space !== 'string') {
    fail('Herdr app returned invalid JSON');
  }
  printStatus(`Opened Herdr app space "${name}"`);
  if (focusedPane) {
    const refocused = await runCommand(context, 'pane.focus', {
      pane: focusedPane,
    });
    if (!refocused.success) {
      printError(
        `Warning: could not restore Herdr app focus: ${refocused.error}`
      );
    }
  }
  return {
    space: {
      id: created.data.space,
      name,
      folder: target.worktreePath,
      terminals: [],
    },
    existed: false,
  };
}

async function selectSpace(
  context: HerdrAppContext,
  space: HerdrAppSpace
): Promise<void> {
  const selected = await runCommand(context, 'space.select', { id: space.id });
  if (!selected.success) fail(selected.error);
}

// From outside the app, bring its window forward, as other providers attach.
async function raiseWindow(context: HerdrAppContext): Promise<void> {
  if (context.currentTerminal) return;
  const raised = await runHerdrApp(context, []);
  if (!raised.success || raised.data.exitCode !== 0) {
    printError('Warning: could not bring the Herdr app window forward');
  }
}

export async function openWithHerdrApp(
  target: ManagedWorkspaceTarget,
  focus: boolean,
  dependencies: HerdrAppAdapterDependencies = {}
): Promise<void> {
  const context = commandContext(dependencies);
  const managed = await ensureSpace(context, target, { keepFocus: !focus });
  if (!focus) return;

  if (managed.existed) {
    printStatus(`Showing existing Herdr app space "${managed.space.name}"`);
  }
  await selectSpace(context, managed.space);
  await raiseWindow(context);
}

function includesTarget(
  completedTargets: ManagedWorkspaceTarget[] | undefined,
  target: ManagedWorkspaceTarget
): boolean {
  return (
    completedTargets === undefined ||
    completedTargets.some(
      (completed) =>
        completed.repoName === target.repoName &&
        completed.branch === target.branch &&
        completed.worktreePath === target.worktreePath
    )
  );
}

export async function planHerdrAppClosure(
  targets: ManagedWorkspaceTarget[],
  focus: ClosureFocusIntent,
  options: ClosurePlanOptions = {},
  dependencies: HerdrAppAdapterDependencies = {}
): Promise<ManagedWorkspaceClosurePlan> {
  const context = commandContext(dependencies);
  const listed = await listSpaces(context);
  if (!listed.success && !listed.windowNotOpen) fail(listed.error);
  if (!listed.success && options.mode !== 'preview') {
    printError(
      'Warning: the Herdr app is not open, so no Herdr app spaces were closed'
    );
  }
  const spaces = listed.success ? listed.data : [];

  const closures: PlannedClosure[] = [];
  for (const target of targets) {
    const matched = await matchSpace(spaces, target);
    if (!matched) continue;
    const existing = closures.find((closure) => closure.spaceId === matched.id);
    if (existing) existing.targets.push(target);
    else
      closures.push({
        spaceId: matched.id,
        name: matched.name,
        targets: [target],
      });
  }

  const currentSpaceId = context.currentTerminal
    ? spaces.find((space) =>
        space.terminals.includes(context.currentTerminal ?? '')
      )?.id
    : undefined;
  const activeClosure = closures.find(
    (closure) => closure.spaceId === currentSpaceId
  );
  if (
    options.mode !== 'preview' &&
    focus.kind === 'preserve' &&
    activeClosure
  ) {
    fail(
      `Cannot clean the active Herdr app space "${activeClosure.name}" with --no-focus.`
    );
  }

  return {
    async preview(): Promise<void> {
      for (const closure of closures) {
        print(`Would close Herdr app space "${closure.name}"`);
      }
    },

    async execute(completedTargets): Promise<void> {
      if (options.mode === 'preview') {
        fail('Cannot execute a preview-only Workspace Manager plan');
      }

      const executing = closures.filter((closure) =>
        closure.targets.some((target) =>
          includesTarget(completedTargets, target)
        )
      );
      // Closing a space ends its terminals, including this one when it is
      // the current space, so that closure goes last.
      const ordered = [
        ...executing.filter((closure) => closure.spaceId !== currentSpaceId),
        ...executing.filter((closure) => closure.spaceId === currentSpaceId),
      ];

      const workingDirectory =
        focus.kind === 'preserve'
          ? focus.destination.path
          : focus.kind === 'destination'
            ? focus.target.worktreePath
            : focus.candidates[0]?.worktreePath;
      if (workingDirectory) process.chdir(workingDirectory);

      if (focus.kind === 'destination') {
        const destination = await ensureSpace(context, focus.target, {
          keepFocus: false,
          excludedSpaceIds: new Set(
            executing.map((closure) => closure.spaceId)
          ),
        });
        if (destination.existed) {
          printStatus(
            `Showing existing Herdr app space "${destination.space.name}"`
          );
        }
        await selectSpace(context, destination.space);
      }

      for (const closure of ordered) {
        const closed = await runCommand(context, 'space.close', {
          id: closure.spaceId,
          confirmed: true,
        });
        if (!closed.success) {
          printError(
            `Warning: Failed to close Herdr app space "${closure.name}": ${closed.error}`
          );
        } else if (focus.kind === 'automatic') {
          print(`Closed Herdr app space "${closure.name}"`);
        }
      }

      if (focus.kind === 'destination') await raiseWindow(context);
    },
  };
}
