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
  // Exit code 1 means session doesn't exist, which is not an error
  if (result.stderr.includes('no server running')) {
    return { success: true, data: false };
  }
  return { success: true, data: false };
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
    return { success: false, error: 'Failed to attach to tmux session' };
  }
  return { success: true, data: undefined };
}

export function isInsideTmux(): boolean {
  return process.env.TMUX !== undefined && process.env.TMUX !== '';
}

export function getSessionName(repoName: string, branch: string): string {
  return `${repoName}-${branch.replace(/\//g, '-')}`;
}
