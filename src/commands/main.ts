import type { CommandContext } from '../cli.ts';
import type { OperationResult } from '../types.ts';
import { loadConfig, resolveRepo } from '../config.ts';
import { printError } from '../output.ts';
import { resolveMainWorktreePath } from '../worktree-config.ts';

export async function mainCommand(
  ctx: CommandContext,
  repoName?: string
): Promise<OperationResult<string>> {
  const config = await loadConfig(ctx.configPath);
  const repo = await resolveRepo(config, repoName);
  const result = await resolveMainWorktreePath(repo.path);
  if (!result.success) {
    return result;
  }

  if (result.data.usedFallback) {
    printError(
      'Warning: Could not find main worktree, using repo path as fallback'
    );
  }

  return { success: true, data: result.data.mainWorktreePath };
}
