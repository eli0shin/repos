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
  sessionIdentity: string | null;
  sessionName: string | null;
  serverPid: string | null;
};

type FocusedSession = { id: string; identity: string; name: string };

function sessionIdentity(session: tmux.SessionInfo): string | null {
  if (!session.id || !session.serverPid) return null;
  return `${session.serverPid}:${session.id}`;
}

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
      sessionIdentity: session ? sessionIdentity(session) : null,
      sessionName: session?.name ?? null,
      serverPid: session?.serverPid ?? null,
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
  const resolvedIdentity = identity ? sessionIdentity(identity) : null;
  if (!identity?.id || !resolvedIdentity) {
    return {
      success: false,
      error: `Current tmux session "${current.data}" was not found`,
    };
  }
  return {
    success: true,
    data: {
      id: identity.id,
      identity: resolvedIdentity,
      name: identity.name,
    },
  };
}

async function killSession(id: string, serverPid: string): Promise<boolean> {
  const result = await tmux.tmuxKillSessionIfIdentity(id, serverPid);
  if (!result.success) {
    printError(`Warning: ${result.error}`);
    return false;
  }
  return result.data;
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
  killingSessionIdentities: Set<string>,
  candidates: PlannedClosure[]
): Promise<boolean> {
  for (const candidate of candidates) {
    if (
      !candidate.sessionId ||
      !candidate.sessionIdentity ||
      candidate.sessionIdentity === currentSession.identity ||
      killingSessionIdentities.has(candidate.sessionIdentity)
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
    const resolvedIdentity = identity ? sessionIdentity(identity) : null;
    if (
      identity?.id &&
      resolvedIdentity &&
      resolvedIdentity !== currentSession.identity &&
      !killingSessionIdentities.has(resolvedIdentity)
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
    const identity = sessionIdentity(freshIdentity);
    if (identity) {
      killingSessionIdentities.delete(identity);
    } else {
      killingSessionIdentities.clear();
    }
  } else {
    killingSessionIdentities.clear();
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
  const killingSessionIdentities = new Set(
    closures.flatMap((closure) =>
      closure.sessionIdentity ? [closure.sessionIdentity] : []
    )
  );

  let currentSession: FocusedSession | null = null;
  if (
    killingSessionIdentities.size > 0 &&
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
    killingSessionIdentities.has(currentSession.identity)
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
        killingSessionIdentities.size > 0 &&
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
        if (killingSessionIdentities.has(executingCurrentSession.identity)) {
          const switched = await selectAutomaticDestination(
            executingCurrentSession,
            killingSessionIdentities,
            candidateClosures
          );
          if (!switched) {
            printError(
              `Warning: cannot kill current tmux session "${executingCurrentSession.name}" — no safe session to switch to`
            );
            killingSessionIdentities.delete(executingCurrentSession.identity);
          }
        }
      }

      if (focus.kind === 'destination' && tmux.isInsideTmux()) {
        await focusDestination(focus.target);
      }

      for (const closure of closures) {
        const {
          sessionId,
          sessionIdentity: identity,
          sessionName: name,
          serverPid,
        } = closure;
        if (
          !sessionId ||
          !identity ||
          !name ||
          !serverPid ||
          !killingSessionIdentities.has(identity)
        ) {
          continue;
        }
        const killed = await killSession(sessionId, serverPid);
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
