export type PullRequestStatus = 'open' | 'merged' | 'closed' | 'unknown';

export type PullRequestInfo = {
  status: PullRequestStatus;
  url?: string;
};

const DEFAULT_GH_TIMEOUT_MS = 10_000;

type GetPullRequestStatusOptions = {
  timeoutMs?: number;
};

type GhPullRequest = {
  state?: string;
  mergedAt?: string | null;
  url?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toGhPullRequest(value: unknown): GhPullRequest | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const { state, mergedAt, url } = value;
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
  if (url !== undefined && typeof url !== 'string') {
    return undefined;
  }

  return { state, mergedAt, url };
}

function formatPullRequestInfo(pr: GhPullRequest): PullRequestInfo {
  const withUrl = (status: PullRequestStatus): PullRequestInfo => ({
    status,
    ...(pr.url ? { url: pr.url } : {}),
  });

  if (pr.state === 'OPEN') {
    return withUrl('open');
  }
  if (pr.state === 'MERGED') {
    return withUrl('merged');
  }
  if (pr.state === 'CLOSED') {
    return withUrl(pr.mergedAt ? 'merged' : 'closed');
  }
  return withUrl('unknown');
}

export async function getPullRequestStatus(
  worktreePath: string,
  branch: string,
  options: GetPullRequestStatusOptions = {}
): Promise<PullRequestInfo | undefined> {
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
        'state,mergedAt,url',
      ],
      {
        cwd: worktreePath,
        env: process.env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const exitResult = await Promise.race([
      proc.exited.then((exitCode) => ({ exitCode })),
      new Promise<{ timedOut: true }>((resolve) => {
        timeout = setTimeout(
          () => resolve({ timedOut: true }),
          options.timeoutMs ?? DEFAULT_GH_TIMEOUT_MS
        );
      }),
    ]);
    if (timeout) clearTimeout(timeout);

    if ('timedOut' in exitResult) {
      proc.kill();
      await proc.exited;
      return { status: 'unknown' };
    }

    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    if (exitResult.exitCode !== 0) {
      return { status: 'unknown' };
    }

    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) {
      return { status: 'unknown' };
    }

    const firstPr = parsed[0];
    if (firstPr === undefined) {
      return undefined;
    }

    const pr = toGhPullRequest(firstPr);
    if (!pr) {
      return { status: 'unknown' };
    }

    return formatPullRequestInfo(pr);
  } catch {
    return { status: 'unknown' };
  }
}
