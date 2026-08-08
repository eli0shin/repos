import type { WorkspaceManagerProvider } from '../types.ts';
import { openWithHerdr, planHerdrClosure } from './herdr-adapter.ts';
import { openWithTmux, planTmuxClosure } from './tmux-adapter.ts';

export type ManagedWorkspaceTarget = {
  repoName: string;
  branch: string;
  worktreePath: string;
};

export type ClosureFocusIntent =
  | { kind: 'preserve'; destination: { path: string } }
  | { kind: 'destination'; target: ManagedWorkspaceTarget }
  | { kind: 'automatic'; candidates: ManagedWorkspaceTarget[] };

export type WorkspaceManagerOptions = {
  provider?: WorkspaceManagerProvider;
};

export type ClosurePlanOptions = WorkspaceManagerOptions & {
  mode?: 'execute' | 'preview';
};

export type ManagedWorkspaceClosurePlan = {
  preview(): Promise<void>;
  execute(completedTargets?: ManagedWorkspaceTarget[]): Promise<void>;
};

export function isInsideHerdr(): boolean {
  return process.env.HERDR_ENV === '1';
}

export function isInsideManagedEnvironment(): boolean {
  return isInsideHerdr() || Boolean(process.env.TMUX);
}

export function resolveWorkspaceManagerProvider(
  configured?: WorkspaceManagerProvider,
  environment: NodeJS.ProcessEnv = process.env
): WorkspaceManagerProvider {
  if (environment.HERDR_ENV === '1') return 'herdr';
  if (environment.TMUX) return 'tmux';
  return configured ?? 'tmux';
}

export async function openManagedWorkspace(
  target: ManagedWorkspaceTarget,
  options: { focus: boolean } & WorkspaceManagerOptions
): Promise<void> {
  const provider = resolveWorkspaceManagerProvider(options.provider);
  if (provider === 'herdr') {
    await openWithHerdr(target, options.focus);
    return;
  }
  await openWithTmux(target, options.focus);
}

export async function planManagedWorkspaceClosure(
  targets: ManagedWorkspaceTarget[],
  focus: ClosureFocusIntent,
  options: ClosurePlanOptions = {}
): Promise<ManagedWorkspaceClosurePlan> {
  const provider = resolveWorkspaceManagerProvider(options.provider);
  if (provider === 'herdr') {
    return planHerdrClosure(targets, focus, options);
  }
  return planTmuxClosure(targets, focus, options);
}
