import type { CommandContext } from '../cli.ts';
import {
  loadConfig,
  resolveRepo,
  getWorktreePath,
  getParentBranch,
  recordStack,
} from '../config.ts';
import {
  createWorktree,
  listWorktrees,
  ensureRefspecConfig,
  findWorktreeByBranch,
  localBranchExists,
  getDefaultBranch,
  runGitCommand,
} from '../git/index.ts';
import { printError, printStatus } from '../output.ts';
import {
  getSessionName,
  isInsideTmux,
  tmuxAttachSession,
  tmuxHasSession,
  tmuxNewSession,
  tmuxSwitchClient,
} from '../tmux.ts';
import type { RepoEntry, ReposConfig } from '../types.ts';

export async function sessionCommand(
  ctx: CommandContext,
  branch: string,
  repoName?: string
): Promise<void> {
  const config = await loadConfig(ctx.configPath);
  const repo = await resolveRepo(config, repoName);

  // Get or create worktree
  let worktreePath: string;
  const worktreesResult = await listWorktrees(repo.path);
  if (worktreesResult.success) {
    const existing = findWorktreeByBranch(worktreesResult.data, branch);
    if (existing) {
      worktreePath = existing.path;
      printStatus(`Reusing existing worktree at ${worktreePath}`);
    } else {
      worktreePath = await createWorktreeForSession(ctx, config, repo, branch);
    }
  } else {
    worktreePath = await createWorktreeForSession(ctx, config, repo, branch);
  }

  const sessionName = getSessionName(repo.name, branch);

  // Create tmux session if it doesn't exist
  const hasSessionResult = await tmuxHasSession(sessionName);
  if (!hasSessionResult.success) {
    printError(`Error: ${hasSessionResult.error}`);
    process.exit(1);
  }

  if (!hasSessionResult.data) {
    const createResult = await tmuxNewSession(sessionName, worktreePath);
    if (!createResult.success) {
      printError(`Error: ${createResult.error}`);
      process.exit(1);
    }
    printStatus(`Created tmux session "${sessionName}"`);
  } else {
    printStatus(`Attaching to existing session "${sessionName}"`);
  }

  // Switch or attach
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

async function createWorktreeForSession(
  ctx: CommandContext,
  config: ReposConfig,
  repo: RepoEntry,
  branch: string
): Promise<string> {
  // Check if branch is new before creating worktree
  const localExists = await localBranchExists(repo.path, branch);
  let remoteExists = false;
  if (!localExists) {
    const remoteBranchResult = await runGitCommand(
      ['ls-remote', '--heads', 'origin', branch],
      repo.path
    );
    remoteExists =
      remoteBranchResult.exitCode === 0 &&
      remoteBranchResult.stdout.includes(`refs/heads/${branch}`);
  }
  const isNewBranch = !localExists && !remoteExists;

  await ensureRefspecConfig(repo.path);

  const worktreePath = getWorktreePath(repo.path, branch);
  printStatus(`Creating worktree for "${branch}"...`);

  const result = await createWorktree(repo.path, worktreePath, branch);
  if (!result.success) {
    printError(`Error: ${result.error}`);
    process.exit(1);
  }

  // Stack new branches on the default branch so restack/unstack work
  // Skip if branch already has a stack relationship in config
  if (isNewBranch && !getParentBranch(repo, branch)) {
    const defaultBranchResult = await getDefaultBranch(repo.path);
    if (defaultBranchResult.success) {
      const defaultBranch = defaultBranchResult.data;
      const headResult = await runGitCommand(
        ['rev-parse', `origin/${defaultBranch}`],
        repo.path
      );
      if (headResult.exitCode === 0) {
        await recordStack(
          repo.path,
          ctx.configPath,
          config,
          repo,
          defaultBranch,
          branch,
          headResult.stdout.trim()
        );
      }
    }
  }

  const repoName = repo.name;
  printStatus(`Created worktree "${repoName}-${branch.replace(/\//g, '-')}"`);
  return worktreePath;
}
