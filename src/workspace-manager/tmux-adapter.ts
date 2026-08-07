import { print, printError } from '../output.ts';
import * as tmux from '../tmux.ts';
import type {
  ClosureFocusIntent,
  ManagedWorkspaceClosurePlan,
  ManagedWorkspaceTarget,
} from './index.ts';

type PlannedClosure = {
  target: ManagedWorkspaceTarget;
  sessionName: string | null;
};

function fail(message: string): never {
  printError(message);
  process.exit(1);
}

async function resolveSessionNames(
  targets: ManagedWorkspaceTarget[],
  sessions: { name: string; path: string }[]
): Promise<PlannedClosure[]> {
  return targets.map((target) => ({
    target,
    sessionName: tmux.matchSession(
      sessions,
      [tmux.getSessionName(target.repoName, target.branch)],
      target.worktreePath
    ),
  }));
}

async function killSession(name: string): Promise<boolean> {
  const result = await tmux.tmuxKillSession(name);
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
  currentSession: string,
  killingSessions: Set<string>,
  candidates: PlannedClosure[]
): Promise<boolean> {
  for (const candidate of candidates) {
    const name =
      candidate.sessionName ??
      tmux.getSessionName(candidate.target.repoName, candidate.target.branch);
    if (name === currentSession || killingSessions.has(name)) continue;
    if (!candidate.sessionName) continue;
    const switched = await tmux.tmuxSwitchClient(name);
    if (switched.success) return true;
  }

  const last = await tmux.tmuxSwitchClientLast();
  if (last.success) return true;

  const fresh = await tmux.tmuxNewSessionDefault();
  if (!fresh.success) return false;
  const switched = await tmux.tmuxSwitchClient(fresh.data);
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
  focus: ClosureFocusIntent
): Promise<ManagedWorkspaceClosurePlan> {
  const listResult = await tmux.tmuxListSessionPaths();
  if (!listResult.success && focus.kind === 'preserve') {
    fail(`Error: ${listResult.error}`);
  }
  const sessions = listResult.success ? listResult.data : [];

  const closures = await resolveSessionNames(targets, sessions);
  const killingSessions = new Set(
    closures.flatMap((closure) =>
      closure.sessionName ? [closure.sessionName] : []
    )
  );

  let currentSession: string | null = null;
  if (tmux.isInsideTmux()) {
    const currentResult = await tmux.tmuxCurrentSession();
    if (focus.kind === 'preserve' && !currentResult.success) {
      fail(`Error: ${currentResult.error}`);
    }
    if (currentResult.success) currentSession = currentResult.data;
  }

  if (
    focus.kind === 'preserve' &&
    currentSession &&
    killingSessions.has(currentSession)
  ) {
    fail(
      `Error: Cannot clean the active tmux session "${currentSession}" with --no-focus.`
    );
  }

  const candidateClosures =
    focus.kind === 'automatic'
      ? await resolveSessionNames(focus.candidates, sessions)
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
      const workingDirectory =
        focus.kind === 'preserve'
          ? focus.destination.path
          : focus.kind === 'destination'
            ? focus.target.worktreePath
            : focus.candidates[0]?.worktreePath;
      if (workingDirectory) process.chdir(workingDirectory);

      if (
        focus.kind === 'automatic' &&
        currentSession &&
        killingSessions.has(currentSession)
      ) {
        const switched = await selectAutomaticDestination(
          currentSession,
          killingSessions,
          candidateClosures
        );
        if (!switched) {
          printError(
            `Warning: cannot kill current tmux session "${currentSession}" — no safe session to switch to`
          );
          killingSessions.delete(currentSession);
        }
      }

      if (focus.kind === 'destination' && tmux.isInsideTmux()) {
        await focusDestination(focus.target);
      }

      for (const closure of closures) {
        const name = closure.sessionName;
        if (!name || !killingSessions.has(name)) continue;
        const killed = await killSession(name);
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
