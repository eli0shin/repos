import type { CommandContext } from '../cli.ts';
import { rebaseStackCommand } from './restack.ts';

type RebaseOptions = {
  index?: number;
  only?: boolean;
};

export async function rebaseCommand(
  ctx: CommandContext,
  branch?: string,
  repoName?: string,
  options: RebaseOptions = {}
): Promise<void> {
  await rebaseStackCommand(ctx, branch, repoName, options);
}
