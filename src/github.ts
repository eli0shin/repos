export type PullRequestStatus = 'open' | 'merged' | 'closed' | 'unknown';

type GhPullRequest = {
  state?: string;
  mergedAt?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toGhPullRequest(value: unknown): GhPullRequest | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const { state, mergedAt } = value;
  if (state !== undefined && typeof state !== 'string') {
    return undefined;
  }
  if (
    mergedAt !== undefined &&
    mergedAt !== null &&
    typeof mergedAt !== 'string'
  ) {
    return undefined;
  }

  return { state, mergedAt };
}

export async function getPullRequestStatus(
  worktreePath: string,
  branch: string
): Promise<PullRequestStatus | undefined> {
  try {
    const proc = Bun.spawn(
      [
        'gh',
        'pr',
        'list',
        '--head',
        branch,
        '--state',
        'all',
        '--limit',
        '1',
        '--json',
        'state,mergedAt',
      ],
      {
        cwd: worktreePath,
        env: process.env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );

    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return 'unknown';
    }

    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) {
      return 'unknown';
    }

    const firstPr = parsed[0];
    if (firstPr === undefined) {
      return undefined;
    }

    const pr = toGhPullRequest(firstPr);
    if (!pr) {
      return 'unknown';
    }

    if (pr.state === 'OPEN') {
      return 'open';
    }
    if (pr.state === 'MERGED') {
      return 'merged';
    }
    if (pr.state === 'CLOSED') {
      return pr.mergedAt ? 'merged' : 'closed';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
