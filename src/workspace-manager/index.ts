import type { WorkspaceManagerProvider } from '../types.ts';
import {
  isHerdrAppTerminal,
  openWithHerdrApp,
  planHerdrAppClosure,
} from './herdr-app-adapter.ts';
import { openWithHerdr, planHerdrClosure } from './herdr-adapter.ts';

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

let insideManagedEnvironment: boolean | undefined;

// Asked once per command definition, so the Herdr app window is asked once.
export function isInsideManagedEnvironment(): boolean {
  insideManagedEnvironment ??=
    isInsideHerdr() || isHerdrAppTerminal(process.env);
  return insideManagedEnvironment;
}

export function resolveWorkspaceManagerProvider(
  configured?: WorkspaceManagerProvider,
  environment: NodeJS.ProcessEnv = process.env
): WorkspaceManagerProvider {
  if (environment.HERDR_ENV === '1') return 'herdr';
  if (isHerdrAppTerminal(environment)) return 'herdr-app';
  return configured ?? 'herdr';
}

export async function openManagedWorkspace(
  target: ManagedWorkspaceTarget,
  options: { focus: boolean } & WorkspaceManagerOptions
): Promise<void> {
  if (resolveWorkspaceManagerProvider(options.provider) === 'herdr-app') {
    await openWithHerdrApp(target, options.focus);
    return;
  }
  await openWithHerdr(target, options.focus);
}

export async function planManagedWorkspaceClosure(
  targets: ManagedWorkspaceTarget[],
  focus: ClosureFocusIntent,
  options: ClosurePlanOptions = {}
): Promise<ManagedWorkspaceClosurePlan> {
  if (resolveWorkspaceManagerProvider(options.provider) === 'herdr-app') {
    return planHerdrAppClosure(targets, focus, options);
  }
  return planHerdrClosure(targets, focus, options);
}
