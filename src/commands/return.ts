import type { CommandContext } from '../cli.ts';
import { loadConfig, resolveRepo } from '../config.ts';
import { listWorktrees } from '../git/index.ts';
import { print, printError } from '../output.ts';

export async function returnCommand(
  ctx: CommandContext,
  repoName?: string
): Promise<void> {
  const config = await loadConfig(ctx.configPath);
  const repo = await resolveRepo(config, repoName);

  const worktreesResult = await listWorktrees(repo.path);
  if (!worktreesResult.success) {
    printError(`Error: ${worktreesResult.error}`);
    process.exit(1);
  }

  const mainWorktree = worktreesResult.data.find((wt) => wt.isMain);
  const outputPath = mainWorktree?.path ?? repo.path;

  print(outputPath);
}
