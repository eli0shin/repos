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

export type ManagedWorkspaceClosurePlan = {
  preview(): Promise<void>;
  execute(): Promise<void>;
};

export async function openManagedWorkspace(
  target: ManagedWorkspaceTarget,
  options: { focus: boolean }
): Promise<void> {
  await openWithTmux(target, options.focus);
}

export { planTmuxClosure as planManagedWorkspaceClosure };
