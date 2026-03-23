import type { CommandContext } from '../cli.ts';
import type { OperationResult } from '../types.ts';
import { loadConfig, resolveRepo } from '../config.ts';
import { resolveMainWorktreePath } from '../worktree-config.ts';

export async function mainCommand(
  ctx: CommandContext,
  repoName?: string
): Promise<OperationResult<string>> {
  const config = await loadConfig(ctx.configPath);
  const repo = await resolveRepo(config, repoName);
  return await resolveMainWorktreePath(repo.path);
}
