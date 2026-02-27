import { basename } from 'node:path';
import type { CommandContext } from '../cli.ts';
import { loadConfig, resolveRepo, getWorktreePath } from '../config.ts';
import {
  createWorktree,
  listWorktrees,
  ensureRefspecConfig,
  findWorktreeByBranch,
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
      worktreePath = await createWorktreeForSession(repo.path, branch);
    }
  } else {
    worktreePath = await createWorktreeForSession(repo.path, branch);
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
  repoPath: string,
  branch: string
): Promise<string> {
  await ensureRefspecConfig(repoPath);

  const worktreePath = getWorktreePath(repoPath, branch);
  printStatus(`Creating worktree for "${branch}"...`);

  const result = await createWorktree(repoPath, worktreePath, branch);
  if (!result.success) {
    printError(`Error: ${result.error}`);
    process.exit(1);
  }

  const repoName = basename(repoPath).replace(/\.git$/, '');
  printStatus(`Created worktree "${repoName}-${branch.replace(/\//g, '-')}"`);
  return worktreePath;
}
