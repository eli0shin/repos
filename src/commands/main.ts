import type { CommandContext } from '../cli.ts';
import type { OperationResult } from '../types.ts';
import { loadConfig, resolveRepo } from '../config.ts';
import { listWorktrees } from '../git/index.ts';
import { printError } from '../output.ts';

export async function mainCommand(
  ctx: CommandContext,
  repoName?: string
): Promise<OperationResult<string>> {
  const config = await loadConfig(ctx.configPath);
  const repo = await resolveRepo(config, repoName);

  const worktreesResult = await listWorktrees(repo.path);
  if (!worktreesResult.success) {
    return { success: false, error: worktreesResult.error };
  }

  const mainWorktree = worktreesResult.data.find((wt) => wt.isMain);
  if (!mainWorktree) {
    printError(
      'Warning: Could not find main worktree, using repo path as fallback'
    );
  }
  const outputPath = mainWorktree?.path ?? repo.path;

  return { success: true, data: outputPath };
}
