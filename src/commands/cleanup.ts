import type { CommandContext } from '../cli.ts';
import { readConfig } from '../config.ts';
import type { RepoEntry } from '../types.ts';
import type { WorktreeInfo } from '../git.ts';
import {
  listWorktrees,
  fetchWithPrune,
  getDefaultBranch,
  getBranchUpstreamStatus,
  isBranchContentMerged,
  hasUncommittedChanges,
  removeWorktree,
  ensureRefspecConfig,
} from '../git.ts';
import { print, printError } from '../output.ts';

export type CleanupOptions = {
  dryRun: boolean;
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

  // Check if upstream is gone
  const upstreamResult = await getBranchUpstreamStatus(
    repo.path,
    worktree.branch
  );
  const upstreamGone = upstreamResult.success && upstreamResult.data === 'gone';

  // Check if merged into default branch (works for squash/rebase merges too)
  const mergedResult = await isBranchContentMerged(
    repo.path,
    worktree.branch,
    defaultBranch
  );
  const isMerged = mergedResult.success && mergedResult.data === true;

  // Skip if neither condition is met
  if (!upstreamGone && !isMerged) {
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
  const configResult = await readConfig(ctx.configPath);
  if (!configResult.success) {
    printError(`Error reading config: ${configResult.error}`);
    process.exit(1);
  }

  // Phase 1: Parallel fetch and preparation for all repos
  const repoContexts = await Promise.all(
    configResult.data.repos.map(prepareRepo)
  );

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
}
