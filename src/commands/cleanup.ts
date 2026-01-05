import type { CommandContext } from '../cli.ts';
import { readConfig } from '../config.ts';
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

export async function cleanupCommand(
  ctx: CommandContext,
  options: CleanupOptions
): Promise<void> {
  const configResult = await readConfig(ctx.configPath);
  if (!configResult.success) {
    printError(`Error reading config: ${configResult.error}`);
    process.exit(1);
  }

  const results: CleanupResult[] = [];

  for (const repo of configResult.data.repos) {
    // Ensure remote tracking refs are configured (needed for bare repos)
    await ensureRefspecConfig(repo.path);

    // Fetch with prune to update remote tracking refs
    const fetchResult = await fetchWithPrune(repo.path);
    if (!fetchResult.success) {
      printError(`Warning: Failed to fetch ${repo.name}: ${fetchResult.error}`);
      continue;
    }

    // Get default branch for merge check
    const defaultBranchResult = await getDefaultBranch(repo.path);
    if (!defaultBranchResult.success) {
      printError(
        `Warning: Could not determine default branch for ${repo.name}`
      );
      continue;
    }
    const defaultBranch = defaultBranchResult.data;

    // List worktrees
    const worktreesResult = await listWorktrees(repo.path);
    if (!worktreesResult.success) {
      printError(
        `Warning: Failed to list worktrees for ${repo.name}: ${worktreesResult.error}`
      );
      continue;
    }

    // Check each non-main worktree
    for (const worktree of worktreesResult.data) {
      if (worktree.isMain || !worktree.branch) {
        continue;
      }

      // Check if upstream is gone
      const upstreamResult = await getBranchUpstreamStatus(
        repo.path,
        worktree.branch
      );
      const upstreamGone =
        upstreamResult.success && upstreamResult.data === 'gone';

      // Check if merged into default branch (works for squash/rebase merges too)
      const mergedResult = await isBranchContentMerged(
        repo.path,
        worktree.branch,
        defaultBranch
      );
      const isMerged = mergedResult.success && mergedResult.data === true;

      // Skip if neither condition is met
      if (!upstreamGone && !isMerged) {
        continue;
      }

      const reason = upstreamGone ? 'upstream-gone' : 'merged';

      // Check for uncommitted changes
      const changesResult = await hasUncommittedChanges(worktree.path);
      if (changesResult.success && changesResult.data) {
        results.push({
          repo: repo.name,
          branch: worktree.branch,
          path: worktree.path,
          reason,
          skipped: 'uncommitted-changes',
        });
        continue;
      }

      results.push({
        repo: repo.name,
        branch: worktree.branch,
        path: worktree.path,
        reason,
      });

      // Remove worktree unless dry-run
      if (!options.dryRun) {
        const removeResult = await removeWorktree(repo.path, worktree.path);
        if (!removeResult.success) {
          printError(
            `Error removing worktree ${worktree.branch}: ${removeResult.error}`
          );
        }
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
}
