import type { CommandContext } from '../cli.ts';
import { loadConfig, findRepoFromCwd } from '../config.ts';
import type { RepoEntry } from '../types.ts';
import type { WorktreeInfo } from '../git/index.ts';
import {
  listWorktrees,
  findWorktreeByBranch,
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
  planManagedWorkspaceClosure,
  type ManagedWorkspaceClosurePlan,
} from '../workspace-manager/index.ts';

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
  worktree: WorktreeInfo
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
      const result = await processWorktree(repoContext, worktree);
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

  const removed = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const liveContexts = repoContexts.filter(
    (repoContext): repoContext is RepoContext => repoContext !== null
  );

  const workspaceTargets = removed.map((result) => ({
    repoName: result.repo,
    branch: result.branch,
    worktreePath: result.path,
  }));
  let workspaceClosure: ManagedWorkspaceClosurePlan | undefined;
  if (options.tmux && removed.length > 0) {
    const removedPaths = new Set(removed.map((result) => result.path));
    workspaceClosure = await planManagedWorkspaceClosure(
      workspaceTargets,
      {
        kind: 'automatic',
        candidates: liveContexts.map((repoContext) => {
          const mainWorktree = repoContext.worktrees.find(
            (worktree) => worktree.isMain
          );
          const defaultWorktree = findWorktreeByBranch(
            repoContext.worktrees,
            repoContext.defaultBranch
          );
          const safeWorktree = [defaultWorktree, mainWorktree].find(
            (worktree) => worktree && !removedPaths.has(worktree.path)
          );
          return {
            repoName: repoContext.repo.name,
            branch: repoContext.defaultBranch,
            worktreePath: safeWorktree?.path ?? repoContext.repo.path,
          };
        }),
      },
      {
        mode: options.dryRun ? 'preview' : 'execute',
        provider: config.config?.workspaceManager,
      }
    );
  }

  const completedPaths = new Set<string>();
  if (options.dryRun) {
    for (const result of removed) completedPaths.add(result.path);
  } else {
    for (const result of removed) {
      const repoContext = liveContexts.find(
        (candidate) => candidate.repo.name === result.repo
      );
      if (!repoContext) continue;
      const removeResult = await removeWorktree(
        repoContext.repo.path,
        result.path,
        { force: true }
      );
      if (removeResult.success) {
        completedPaths.add(result.path);
      } else {
        printError(
          `Error removing worktree ${result.branch}: ${removeResult.error}`
        );
      }
    }
  }

  const prefix = options.dryRun ? 'Would remove' : 'Removed';
  const completed = removed.filter((result) => completedPaths.has(result.path));

  for (const result of results) {
    if (result.skipped === 'uncommitted-changes') {
      print(
        `Skipped ${result.repo}/${result.branch}: uncommitted changes (${result.reason})`
      );
    } else if (completedPaths.has(result.path)) {
      const reasonText =
        result.reason === 'upstream-gone' ? 'upstream deleted' : 'merged';
      print(`${prefix} ${result.repo}/${result.branch} (${reasonText})`);
    }
  }

  // Summary
  if (completed.length > 0) {
    const merged = completed.filter((r) => r.reason === 'merged').length;
    const upstreamGone = completed.filter(
      (r) => r.reason === 'upstream-gone'
    ).length;

    const parts: string[] = [];
    if (merged > 0) parts.push(`${merged} merged`);
    if (upstreamGone > 0) parts.push(`${upstreamGone} upstream deleted`);

    const verb = options.dryRun ? 'Would remove' : 'Removed';
    print(`\n${verb} ${completed.length} worktree(s) (${parts.join(', ')})`);
  }

  if (skipped.length > 0) {
    print(`Skipped ${skipped.length} worktree(s) with uncommitted changes`);
  }

  if (workspaceClosure) {
    if (options.dryRun) {
      await workspaceClosure.preview();
    } else {
      await workspaceClosure.execute(
        workspaceTargets.filter((target) =>
          completedPaths.has(target.worktreePath)
        )
      );
    }
  }
}
