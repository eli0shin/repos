import { print, printError } from '../output.ts';
import * as tmux from '../tmux.ts';
import type {
  ClosureFocusIntent,
  ClosurePlanOptions,
  ManagedWorkspaceClosurePlan,
  ManagedWorkspaceTarget,
} from './index.ts';

type PlannedClosure = {
  target: ManagedWorkspaceTarget;
  sessionId: string | null;
  sessionName: string | null;
};

type FocusedSession = { id: string; name: string };

function fail(message: string): never {
  printError(message);
  process.exit(1);
}

function resolveSessionNames(
  targets: ManagedWorkspaceTarget[],
  sessions: tmux.SessionInfo[]
): PlannedClosure[] {
  return targets.map((target) => {
    const session = tmux.matchSessionInfo(
      sessions,
      [tmux.getSessionName(target.repoName, target.branch)],
      target.worktreePath
    );
    return {
      target,
      sessionId: session?.id ?? session?.name ?? null,
      sessionName: session?.name ?? null,
    };
  });
}

async function readCurrentSession(
  sessions?: tmux.SessionInfo[]
): Promise<
  { success: true; data: FocusedSession } | { success: false; error: string }
> {
  const current = await tmux.tmuxCurrentSession();
  if (!current.success) return current;

  let availableSessions = sessions;
  if (!availableSessions) {
    const listed = await tmux.tmuxListSessionPaths();
    if (!listed.success) return listed;
    availableSessions = listed.data;
  }

  const identity = availableSessions.find(
    (session) => session.name === current.data
  );
  if (!identity?.id) {
    return {
      success: false,
      error: `Current tmux session "${current.data}" was not found`,
    };
  }
  return {
    success: true,
    data: { id: identity.id, name: identity.name },
  };
}

async function killSession(id: string): Promise<boolean> {
  const hasSession = await tmux.tmuxHasSession(id);
  if (!hasSession.success) {
    printError(`Warning: ${hasSession.error}`);
    return false;
  }
  if (!hasSession.data) return false;
  const result = await tmux.tmuxKillSession(id);
  if (!result.success) {
    printError(`Warning: ${result.error}`);
    return false;
  }
  return true;
}

async function focusDestination(target: ManagedWorkspaceTarget): Promise<void> {
  await tmux.openTmuxSession(
    target.repoName,
    target.branch,
    target.worktreePath
  );
}

async function selectAutomaticDestination(
  currentSession: FocusedSession,
  killingSessionIds: Set<string>,
  candidates: PlannedClosure[]
): Promise<boolean> {
  for (const candidate of candidates) {
    if (
      !candidate.sessionId ||
      candidate.sessionId === currentSession.id ||
      killingSessionIds.has(candidate.sessionId)
    ) {
      continue;
    }
    const switched = await tmux.tmuxSwitchClient(candidate.sessionId);
    if (switched.success) return true;
  }

  const lastSession = await tmux.tmuxLastSession();
  if (lastSession.success) {
    const listed = await tmux.tmuxListSessionPaths();
    const identity = listed.success
      ? listed.data.find((session) => session.name === lastSession.data)
      : undefined;
    if (
      identity?.id &&
      identity.id !== currentSession.id &&
      !killingSessionIds.has(identity.id)
    ) {
      const switched = await tmux.tmuxSwitchClient(identity.id);
      if (switched.success) return true;
    }
  }

  const fresh = await tmux.tmuxNewSessionDefault();
  if (!fresh.success) return false;
  const listed = await tmux.tmuxListSessionPaths();
  const freshIdentity = listed.success
    ? listed.data.find((session) => session.name === fresh.data)
    : undefined;
  if (freshIdentity?.id) {
    killingSessionIds.delete(freshIdentity.id);
  } else {
    killingSessionIds.clear();
  }
  const switched = await tmux.tmuxSwitchClient(freshIdentity?.id ?? fresh.data);
  return switched.success;
}

export async function openWithTmux(
  target: ManagedWorkspaceTarget,
  focus: boolean
): Promise<void> {
  if (focus) {
    await tmux.openTmuxSession(
      target.repoName,
      target.branch,
      target.worktreePath
    );
    return;
  }
  await tmux.ensureTmuxSession(
    target.repoName,
    target.branch,
    target.worktreePath
  );
}

export async function planTmuxClosure(
  targets: ManagedWorkspaceTarget[],
  focus: ClosureFocusIntent,
  options: ClosurePlanOptions = {}
): Promise<ManagedWorkspaceClosurePlan> {
  const listResult = await tmux.tmuxListSessionPaths();
  const requiresSafePlanning =
    focus.kind === 'preserve' ||
    (focus.kind === 'automatic' &&
      tmux.isInsideTmux() &&
      options.mode !== 'preview');
  if (!listResult.success && requiresSafePlanning) {
    fail(`Error: ${listResult.error}`);
  }
  const sessions = listResult.success ? listResult.data : [];

  const closures = resolveSessionNames(targets, sessions);
  const killingSessionIds = new Set(
    closures.flatMap((closure) =>
      closure.sessionId ? [closure.sessionId] : []
    )
  );

  let currentSession: FocusedSession | null = null;
  if (
    killingSessionIds.size > 0 &&
    tmux.isInsideTmux() &&
    options.mode !== 'preview'
  ) {
    const currentResult = await readCurrentSession(sessions);
    if (focus.kind !== 'destination' && !currentResult.success) {
      fail(`Error: ${currentResult.error}`);
    }
    if (currentResult.success) currentSession = currentResult.data;
  }

  if (
    focus.kind === 'preserve' &&
    currentSession &&
    killingSessionIds.has(currentSession.id)
  ) {
    fail(
      `Error: Cannot clean the active tmux session "${currentSession.name}" with --no-focus.`
    );
  }

  const candidateClosures =
    focus.kind === 'automatic'
      ? resolveSessionNames(focus.candidates, sessions)
      : [];

  return {
    async preview(): Promise<void> {
      for (const closure of closures) {
        if (closure.sessionName) {
          print(`Would kill tmux session "${closure.sessionName}"`);
        }
      }
    },

    async execute(): Promise<void> {
      if (options.mode === 'preview') {
        fail('Error: Cannot execute a preview-only Workspace Manager plan');
      }

      const workingDirectory =
        focus.kind === 'preserve'
          ? focus.destination.path
          : focus.kind === 'destination'
            ? focus.target.worktreePath
            : focus.candidates[0]?.worktreePath;
      if (workingDirectory) process.chdir(workingDirectory);

      if (
        focus.kind === 'automatic' &&
        killingSessionIds.size > 0 &&
        tmux.isInsideTmux()
      ) {
        const currentResult = await readCurrentSession();
        if (!currentResult.success) {
          printError(
            `Warning: cannot identify current tmux session — no tmux sessions were killed: ${currentResult.error}`
          );
          return;
        }
        const executingCurrentSession = currentResult.data;
        if (killingSessionIds.has(executingCurrentSession.id)) {
          const switched = await selectAutomaticDestination(
            executingCurrentSession,
            killingSessionIds,
            candidateClosures
          );
          if (!switched) {
            printError(
              `Warning: cannot kill current tmux session "${executingCurrentSession.name}" — no safe session to switch to`
            );
            killingSessionIds.delete(executingCurrentSession.id);
          }
        }
      }

      if (focus.kind === 'destination' && tmux.isInsideTmux()) {
        await focusDestination(focus.target);
      }

      for (const closure of closures) {
        const { sessionId, sessionName: name } = closure;
        if (!sessionId || !name || !killingSessionIds.has(sessionId)) continue;
        const killed = await killSession(sessionId);
        if (killed && focus.kind === 'automatic') {
          print(`Killed tmux session "${name}"`);
        }
      }

      if (focus.kind === 'destination' && !tmux.isInsideTmux()) {
        await focusDestination(focus.target);
      }
    },
  };
}
