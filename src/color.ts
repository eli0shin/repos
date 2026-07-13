import type { PullRequestStatus } from './github.ts';

const RESET = '\u001B[0m';

const colors = {
  yellow: 33,
  green: 32,
  magenta: 35,
  red: 31,
  brightCyan: 96,
} as const;

const colorByPullRequestStatus = {
  open: colors.green,
  merged: colors.magenta,
  closed: colors.red,
  unknown: colors.yellow,
} satisfies Record<PullRequestStatus, number>;

function shouldUseColor(): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }

  return process.env.FORCE_COLOR === '1' || process.stdout.isTTY === true;
}

function colorize(value: string, color: number): string {
  if (!shouldUseColor()) {
    return value;
  }

  return `\u001B[${color}m${value}${RESET}`;
}

export function colorWorktreeIndex(index: number): string {
  return colorize(`[${index}]`, colors.yellow);
}

export function colorWorktreeName(name: string): string {
  return colorize(name, colors.brightCyan);
}

export function colorPullRequestStatus(
  label: string,
  status: PullRequestStatus
): string {
  return colorize(label, colorByPullRequestStatus[status]);
}
