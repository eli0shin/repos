import { getDefaultBranch } from '../git/branch.ts';
import { resolveRef } from '../git/repository.ts';
import type { OperationResult, RepoEntry, ReposConfig } from '../types.ts';
import { updateRepoInConfig, writeConfig } from '../config.ts';
import {
  computeForkPoint,
  discardForkPoint,
  recordForkPoint,
} from './fork-point.ts';
import {
  addStackEntry,
  getChildBranches,
  getParentBranch,
  removeStackEntriesByParent,
  removeStackEntry,
} from './topology.ts';

export { getChildBranches, getParentBranch } from './topology.ts';
export {
  getForkPoint,
  resolveForkPoint,
  type ResolveForkPointResult,
} from './fork-point.ts';

export type BranchStackReport = {
  warnings: string[];
};

export type BranchStackUpdate = BranchStackReport & {
  repo: RepoEntry;
  persistence: OperationResult;
};

async function persistRepo(
  configPath: string,
  config: ReposConfig,
  repo: RepoEntry
): Promise<OperationResult> {
  return writeConfig(configPath, updateRepoInConfig(config, repo));
}

function persistenceWarning(result: OperationResult): string[] {
  return result.success
    ? []
    : [`Warning: Failed to update config: ${result.error}`];
}

export async function recordBranchStack(
  repoPath: string,
  configPath: string,
  config: ReposConfig,
  repo: RepoEntry,
  parentBranch: string,
  childBranch: string,
  forkPoint: string
): Promise<BranchStackUpdate> {
  const warnings: string[] = [];
  const forkPointResult = await recordForkPoint(
    repoPath,
    childBranch,
    forkPoint
  );
  if (!forkPointResult.success) {
    warnings.push(
      `Warning: Failed to create base ref: ${forkPointResult.error}`
    );
  }

  const updatedRepo = addStackEntry(repo, parentBranch, childBranch);
  const persistence = await persistRepo(configPath, config, updatedRepo);
  warnings.push(...persistenceWarning(persistence));

  return { repo: updatedRepo, persistence, warnings };
}

export async function recordBranchStackOnDefault(
  configPath: string,
  config: ReposConfig,
  repo: RepoEntry,
  branch: string
): Promise<BranchStackUpdate | BranchStackReport> {
  if (getParentBranch(repo, branch)) return { warnings: [] };

  const defaultBranchResult = await getDefaultBranch(repo.path);
  if (!defaultBranchResult.success) return { warnings: [] };

  const defaultBranch = defaultBranchResult.data;
  const headResult = await resolveRef(repo.path, `origin/${defaultBranch}`);
  if (!headResult.success) {
    return {
      warnings: [
        `Warning: Could not resolve origin/${defaultBranch} — stack entry not recorded. ` +
          `Run "repos stack" manually, or fetch and retry.`,
      ],
    };
  }

  return recordBranchStack(
    repo.path,
    configPath,
    config,
    repo,
    defaultBranch,
    branch,
    headResult.data
  );
}

export async function removeBranchStackParent(
  configPath: string,
  config: ReposConfig,
  repo: RepoEntry,
  branch: string
): Promise<BranchStackUpdate> {
  const updatedRepo = removeStackEntry(repo, branch);
  const persistence = await persistRepo(configPath, config, updatedRepo);
  return {
    repo: updatedRepo,
    persistence,
    warnings: persistenceWarning(persistence),
  };
}

export async function removeBranchStack(
  configPath: string,
  config: ReposConfig,
  repo: RepoEntry,
  branch: string
): Promise<BranchStackReport> {
  const children = getChildBranches(repo, branch);
  let updatedRepo = removeStackEntry(repo, branch);
  updatedRepo = removeStackEntriesByParent(updatedRepo, branch);

  const warnings: string[] = [];
  if (updatedRepo !== repo) {
    const persistence = await persistRepo(configPath, config, updatedRepo);
    warnings.push(...persistenceWarning(persistence));
  }

  await discardForkPoint(repo.path, branch);
  for (const child of children) {
    await discardForkPoint(repo.path, child);
  }

  return { warnings };
}

export async function recoverForkPoint(
  repo: RepoEntry,
  worktreePath: string,
  childBranch: string,
  parentBranch: string
): Promise<OperationResult<string>> {
  const result = await computeForkPoint(
    worktreePath,
    childBranch,
    parentBranch
  );
  if (result.success) {
    await recordForkPoint(repo.path, childBranch, result.data);
  }
  return result;
}

// These intent-level operations keep Git ref mutation behind the Branch Stack
// seam while allowing command adapters to preserve their existing messages.
// eslint-disable-next-line for-ai/no-bare-wrapper
export async function completeBranchRebase(
  repoPath: string,
  branch: string,
  parentCommit: string
): Promise<OperationResult> {
  return recordForkPoint(repoPath, branch, parentCommit);
}

// eslint-disable-next-line for-ai/no-bare-wrapper
export async function removeObsoleteForkPoint(
  repoPath: string,
  branch: string
): Promise<OperationResult> {
  return discardForkPoint(repoPath, branch);
}
