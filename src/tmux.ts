import { printError, printStatus } from './output.ts';
import type { OperationResult } from './types.ts';

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

async function runTmuxCommand(args: string[]): Promise<CommandResult> {
  const proc = Bun.spawn(['tmux', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

export async function tmuxHasSession(
  name: string
): Promise<OperationResult<boolean>> {
  const result = await runTmuxCommand(['has-session', '-t', name]);
  if (result.exitCode === 0) {
    return { success: true, data: true };
  }
  // Exit code 1 means the session does not exist (including "no server running")
  if (result.exitCode === 1) {
    return { success: true, data: false };
  }
  // Any other exit code indicates an unexpected error (e.g. permission denied)
  return { success: false, error: result.stderr || 'tmux has-session failed' };
}

export async function tmuxNewSession(
  name: string,
  startDirectory: string
): Promise<OperationResult> {
  const result = await runTmuxCommand([
    'new-session',
    '-d',
    '-s',
    name,
    '-c',
    startDirectory,
  ]);
  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to create tmux session',
    };
  }
  return { success: true, data: undefined };
}

export async function tmuxKillSession(name: string): Promise<OperationResult> {
  const result = await runTmuxCommand(['kill-session', '-t', name]);
  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to kill tmux session',
    };
  }
  return { success: true, data: undefined };
}

export async function tmuxSwitchClient(name: string): Promise<OperationResult> {
  const result = await runTmuxCommand(['switch-client', '-t', name]);
  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to switch tmux client',
    };
  }
  return { success: true, data: undefined };
}

export async function tmuxSwitchClientLast(): Promise<OperationResult> {
  const result = await runTmuxCommand(['switch-client', '-l']);
  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to switch to last tmux session',
    };
  }
  return { success: true, data: undefined };
}

export async function tmuxCurrentSession(): Promise<OperationResult<string>> {
  const result = await runTmuxCommand(['display-message', '-p', '#S']);
  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to read current tmux session',
    };
  }
  return { success: true, data: result.stdout };
}

export async function tmuxNewSessionDefault(): Promise<
  OperationResult<string>
> {
  const result = await runTmuxCommand([
    'new-session',
    '-d',
    '-P',
    '-F',
    '#{session_name}',
  ]);
  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to create tmux session',
    };
  }
  return { success: true, data: result.stdout };
}

export async function tmuxAttachSession(
  name: string
): Promise<OperationResult> {
  const proc = Bun.spawn(['tmux', 'attach-session', '-t', name], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    // stderr is inherited (already printed to terminal), so include a hint
    return {
      success: false,
      error: `Failed to attach to tmux session — try: tmux attach-session -t ${name}`,
    };
  }
  return { success: true, data: undefined };
}

export function isInsideTmux(): boolean {
  return process.env.TMUX !== undefined && process.env.TMUX !== '';
}

// Use '@' as the separator between repo name and branch to avoid collisions.
// e.g. repo "foo-bar" + branch "baz" vs repo "foo" + branch "bar-baz" would
// both produce "foo-bar-baz" with a dash separator, but are distinct with '@'.
// Note: ':' cannot be used because tmux interprets it as a session:window separator
// in -t target strings, causing switch-client and has-session to fail.
export function getSessionName(repoName: string, branch: string): string {
  return `${repoName}@${branch.replace(/\//g, '-')}`;
}

type SessionInfo = { name: string; path: string };

export async function tmuxListSessionPaths(): Promise<
  OperationResult<SessionInfo[]>
> {
  const result = await runTmuxCommand([
    'list-sessions',
    '-F',
    '#{session_name}\t#{pane_current_path}',
  ]);
  if (result.exitCode === 1) {
    return { success: true, data: [] };
  }
  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to list tmux sessions',
    };
  }
  const sessions = result.stdout
    .split('\n')
    .filter((line) => line.includes('\t'))
    .map((line) => {
      const [name, path] = line.split('\t');
      return { name, path };
    });
  return { success: true, data: sessions };
}

export function matchSession(
  sessions: SessionInfo[],
  candidateNames: string[],
  worktreePath: string
): string | null {
  for (const name of candidateNames) {
    if (sessions.some((s) => s.name === name)) {
      return name;
    }
  }

  const prefix = worktreePath.endsWith('/') ? worktreePath : worktreePath + '/';
  const match = sessions.find(
    (s) => s.path === worktreePath || s.path.startsWith(prefix)
  );
  return match?.name ?? null;
}

export async function findSessionForWorktree(
  repoName: string,
  branch: string,
  worktreePath: string
): Promise<OperationResult<string | null>> {
  const listResult = await tmuxListSessionPaths();
  if (!listResult.success) {
    return listResult;
  }
  const candidateNames = [getSessionName(repoName, branch), repoName];
  return {
    success: true,
    data: matchSession(listResult.data, candidateNames, worktreePath),
  };
}

export async function openTmuxSession(
  repoName: string,
  branch: string,
  worktreePath: string
): Promise<void> {
  const findResult = await findSessionForWorktree(
    repoName,
    branch,
    worktreePath
  );
  if (!findResult.success) {
    printError(`Error: ${findResult.error}`);
    process.exit(1);
  }

  const sessionName = findResult.data ?? getSessionName(repoName, branch);

  if (!findResult.data) {
    const createResult = await tmuxNewSession(sessionName, worktreePath);
    if (!createResult.success) {
      printError(`Error: ${createResult.error}`);
      process.exit(1);
    }
    printStatus(`Created tmux session "${sessionName}"`);
  } else {
    printStatus(`Attaching to existing session "${sessionName}"`);
  }

  if (isInsideTmux()) {
    const switchResult = await tmuxSwitchClient(sessionName);
    if (!switchResult.success) {
      printError(`Error: ${switchResult.error}`);
      process.exit(1);
    }
  } else {
    const attachResult = await tmuxAttachSession(sessionName);
    if (!attachResult.success) {
      printError(`Error: ${attachResult.error}`);
      process.exit(1);
    }
  }
}
