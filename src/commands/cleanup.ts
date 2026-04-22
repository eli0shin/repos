import type { CommandContext } from '../cli.ts';
import { loadConfig, findRepoFromCwd } from '../config.ts';
import type { RepoEntry } from '../types.ts';
import type { WorktreeInfo } from '../git/index.ts';
import {
  listWorktrees,
  fetchWithPrune,
  getDefaultBranch,
  getBranchUpstreamStatus,
  isBranchContentMerged,
  hasUncommittedChanges,
  removeWorktree,
  pruneWorktrees,
  ensureRefspecConfig,
} from '../git/index.ts';
import { print, printError } from '../output.ts';
import {
  getSessionName,
  isInsideTmux,
  tmuxCurrentSession,
  tmuxHasSession,
  tmuxKillSession,
  tmuxNewSessionDefault,
  tmuxSwitchClient,
  tmuxSwitchClientLast,
} from '../tmux.ts';

export type CleanupOptions = {
  dryRun: boolean;
  tmux: boolean;
};

type CleanupResult = {
  repo: string;
  branch: string;
  path: string;
  reason: 'upstream-gone' | 'merged';
  skipped?: 'uncommitted-changes';
};

type RepoContext = {
  repo: RepoEntry;
  defaultBranch: string;
  worktrees: WorktreeInfo[];
};

async function prepareRepo(repo: RepoEntry): Promise<RepoContext | null> {
  // Ensure remote tracking refs are configured (needed for bare repos)
  await ensureRefspecConfig(repo.path);

  // Fetch with prune to update remote tracking refs
  const fetchResult = await fetchWithPrune(repo.path);
  if (!fetchResult.success) {
    printError(`Warning: Failed to fetch ${repo.name}: ${fetchResult.error}`);
    return null;
  }

  // Prune stale worktree references (handles manually-deleted directories)
  const pruneResult = await pruneWorktrees(repo.path);
  if (!pruneResult.success) {
    printError(
      `Warning: Failed to prune worktrees for ${repo.name}: ${pruneResult.error}`
    );
  }

  // Get default branch for merge check
  const defaultBranchResult = await getDefaultBranch(repo.path);
  if (!defaultBranchResult.success) {
    printError(`Warning: Could not determine default branch for ${repo.name}`);
    return null;
  }

  // List worktrees
  const worktreesResult = await listWorktrees(repo.path);
  if (!worktreesResult.success) {
    printError(
      `Warning: Failed to list worktrees for ${repo.name}: ${worktreesResult.error}`
    );
    return null;
  }

  return {
    repo,
    defaultBranch: defaultBranchResult.data,
    worktrees: worktreesResult.data,
  };
}

async function processWorktree(
  repoContext: RepoContext,
  worktree: WorktreeInfo,
  options: CleanupOptions
): Promise<CleanupResult | null> {
  const { repo, defaultBranch } = repoContext;

  if (worktree.isMain || !worktree.branch) {
    return null;
  }

  // Check upstream status
  const upstreamResult = await getBranchUpstreamStatus(
    repo.path,
    worktree.branch
  );
  const upstreamStatus = upstreamResult.success ? upstreamResult.data : null;
  const upstreamGone = upstreamStatus === 'gone';
  const isTracking = upstreamStatus === 'tracking';

  // Check if merged into default branch (works for squash/rebase merges too)
  const mergedResult = await isBranchContentMerged(
    repo.path,
    worktree.branch,
    defaultBranch
  );
  const isMerged = mergedResult.success && mergedResult.data === true;

  // Cleanup conditions:
  // 1. Remote branch was deleted (upstream-gone)
  // 2. Branch is tracking remote AND merged (unpushed branches won't be tracking)
  const shouldCleanup = upstreamGone || (isTracking && isMerged);

  if (!shouldCleanup) {
    return null;
  }

  const reason = upstreamGone ? 'upstream-gone' : 'merged';

  // Check for uncommitted changes
  const changesResult = await hasUncommittedChanges(worktree.path);
  if (changesResult.success && changesResult.data) {
    return {
      repo: repo.name,
      branch: worktree.branch,
      path: worktree.path,
      reason,
      skipped: 'uncommitted-changes',
    };
  }

  // Remove worktree unless dry-run
  if (!options.dryRun) {
    const removeResult = await removeWorktree(repo.path, worktree.path);
    if (!removeResult.success) {
      printError(
        `Error removing worktree ${worktree.branch}: ${removeResult.error}`
      );
    }
  }

  return {
    repo: repo.name,
    branch: worktree.branch,
    path: worktree.path,
    reason,
  };
}

export async function cleanupCommand(
  ctx: CommandContext,
  options: CleanupOptions
): Promise<void> {
  const config = await loadConfig(ctx.configPath);

  // If inside a tracked repo, only clean that repo; otherwise clean all repos
  const currentRepo = await findRepoFromCwd(config, process.cwd());
  const reposToProcess = currentRepo ? [currentRepo] : config.repos;

  // Phase 1: Parallel fetch and preparation for repos
  const repoContexts = await Promise.all(reposToProcess.map(prepareRepo));

  // Phase 2: Process worktrees for each repo
  const results: CleanupResult[] = [];
  for (const repoContext of repoContexts) {
    if (!repoContext) continue;

    for (const worktree of repoContext.worktrees) {
      const result = await processWorktree(repoContext, worktree, options);
      if (result) {
        results.push(result);
      }
    }
  }

  // Output results
  if (results.length === 0) {
    print('No worktrees to clean up');
    return;
  }

  const prefix = options.dryRun ? 'Would remove' : 'Removed';

  for (const result of results) {
    if (result.skipped === 'uncommitted-changes') {
      print(
        `Skipped ${result.repo}/${result.branch}: uncommitted changes (${result.reason})`
      );
    } else {
      const reasonText =
        result.reason === 'upstream-gone' ? 'upstream deleted' : 'merged';
      print(`${prefix} ${result.repo}/${result.branch} (${reasonText})`);
    }
  }

  // Summary
  const removed = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  if (removed.length > 0) {
    const merged = removed.filter((r) => r.reason === 'merged').length;
    const upstreamGone = removed.filter(
      (r) => r.reason === 'upstream-gone'
    ).length;

    const parts: string[] = [];
    if (merged > 0) parts.push(`${merged} merged`);
    if (upstreamGone > 0) parts.push(`${upstreamGone} upstream deleted`);

    const verb = options.dryRun ? 'Would remove' : 'Removed';
    print(`\n${verb} ${removed.length} worktree(s) (${parts.join(', ')})`);
  }

  if (skipped.length > 0) {
    print(`Skipped ${skipped.length} worktree(s) with uncommitted changes`);
  }

  if (options.tmux) {
    // The cwd may have been a worktree we just removed; move somewhere
    // valid so subsequent subprocess spawns (tmux) can resolve their cwd.
    const liveContexts = repoContexts.filter(
      (ctx): ctx is RepoContext => ctx !== null
    );
    const safeDir = liveContexts[0]?.repo.path;
    if (safeDir) process.chdir(safeDir);

    const killingSessions = new Set(
      removed.map((r) => getSessionName(r.repo, r.branch))
    );

    // If we're inside tmux and about to kill the session hosting this
    // command, switch the client away first — otherwise killing the
    // current session disconnects the client from the tmux server.
    let skipCurrentSession: string | null = null;
    if (!options.dryRun && isInsideTmux()) {
      const currentResult = await tmuxCurrentSession();
      if (currentResult.success && killingSessions.has(currentResult.data)) {
        const switched = await switchClientAwayFromCurrentSession(
          currentResult.data,
          killingSessions,
          liveContexts
        );
        if (!switched) {
          printError(
            `Warning: cannot kill current tmux session "${currentResult.data}" — no safe session to switch to`
          );
          skipCurrentSession = currentResult.data;
        }
      }
    }

    const killPrefix = options.dryRun ? 'Would kill' : 'Killed';
    for (const result of removed) {
      const sessionName = getSessionName(result.repo, result.branch);
      if (sessionName === skipCurrentSession) continue;
      const hasSession = await tmuxHasSession(sessionName);
      if (!hasSession.success || !hasSession.data) continue;

      if (!options.dryRun) {
        const killResult = await tmuxKillSession(sessionName);
        if (!killResult.success) {
          printError(`Warning: ${killResult.error}`);
          continue;
        }
      }
      print(`${killPrefix} tmux session "${sessionName}"`);
    }
  }
}

async function switchClientAwayFromCurrentSession(
  currentSession: string,
  killingSessions: Set<string>,
  repoContexts: RepoContext[]
): Promise<boolean> {
  // 1. Prefer an existing main-worktree session for a repo we're processing
  for (const ctx of repoContexts) {
    const candidate = getSessionName(ctx.repo.name, ctx.defaultBranch);
    if (candidate === currentSession || killingSessions.has(candidate))
      continue;
    const has = await tmuxHasSession(candidate);
    if (!has.success || !has.data) continue;
    const sw = await tmuxSwitchClient(candidate);
    if (sw.success) return true;
  }

  // 2. Fall back to the last-visited session (mirrors user's tmux keybind)
  const last = await tmuxSwitchClientLast();
  if (last.success) return true;

  // 3. Last resort: create a fresh unnamed session and switch to it
  const fresh = await tmuxNewSessionDefault();
  if (!fresh.success) return false;
  const sw = await tmuxSwitchClient(fresh.data);
  return sw.success;
}
