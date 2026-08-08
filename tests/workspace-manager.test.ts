import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as tmux from '../src/tmux.ts';
import {
  openManagedWorkspace as openWorkspace,
  planManagedWorkspaceClosure as planClosure,
  type ClosureFocusIntent,
  type ClosurePlanOptions,
  type ManagedWorkspaceTarget,
} from '../src/workspace-manager/index.ts';

const testDir = `/tmp/repos-test-workspace-manager-${process.pid}`;
const repoName = `repos-test-workspace-manager-${process.pid}`;
const sessions = [
  `${repoName}@feature`,
  `${repoName}@other`,
  `${repoName}@main`,
];

async function openManagedWorkspace(
  target: ManagedWorkspaceTarget,
  options: { focus: boolean }
): Promise<void> {
  await openWorkspace(target, { ...options, provider: 'tmux' });
}

async function planManagedWorkspaceClosure(
  targets: ManagedWorkspaceTarget[],
  focus: ClosureFocusIntent,
  options: ClosurePlanOptions = {}
) {
  return planClosure(targets, focus, { ...options, provider: 'tmux' });
}

async function getSessionId(name: string): Promise<string> {
  const sessions = await tmux.tmuxListSessionPaths();
  if (!sessions.success) throw new Error(sessions.error);
  const session = sessions.data.find((candidate) => candidate.name === name);
  if (!session?.id) throw new Error(`Session not found: ${name}`);
  return session.id;
}

function captureStdout(): { output: string[]; restore: () => void } {
  const output: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    output.push(
      typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    );
    return true;
  };
  return {
    output,
    restore: () => {
      process.stdout.write = originalWrite;
    },
  };
}

describe('Workspace Manager', () => {
  let target: ManagedWorkspaceTarget;
  let safePath: string;
  let transientSessions: string[];

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    safePath = join(testDir, 'safe');
    const worktreePath = join(testDir, 'feature');
    await mkdir(safePath, { recursive: true });
    await mkdir(worktreePath, { recursive: true });
    target = { repoName, branch: 'feature', worktreePath };
    transientSessions = [];
    for (const session of sessions) await tmux.tmuxKillSession(session);
  });

  afterEach(async () => {
    process.chdir('/tmp');
    for (const session of [...sessions, ...transientSessions]) {
      await tmux.tmuxKillSession(session);
    }
    await rm(testDir, { recursive: true, force: true });
  });

  test('opens and reuses a Managed Workspace while preserving focus', async () => {
    const switchSpy = spyOn(tmux, 'tmuxSwitchClient');
    const attachSpy = spyOn(tmux, 'tmuxAttachSession');

    await openManagedWorkspace(target, { focus: false });
    await openManagedWorkspace(target, { focus: false });

    expect(await tmux.tmuxHasSession(`${repoName}@feature`)).toEqual({
      success: true,
      data: true,
    });
    expect(switchSpy).not.toHaveBeenCalled();
    expect(attachSpy).not.toHaveBeenCalled();
    attachSpy.mockRestore();
    switchSpy.mockRestore();
  });

  test('previews and executes a captured closure after its worktree is removed', async () => {
    await openManagedWorkspace(target, { focus: false });
    const plan = await planManagedWorkspaceClosure([target], {
      kind: 'preserve',
      destination: { path: safePath },
    });
    const { output, restore } = captureStdout();

    await plan.preview();
    await rm(target.worktreePath, { recursive: true });
    await plan.execute();
    restore();

    expect(output).toEqual([`Would kill tmux session "${repoName}@feature"\n`]);
    expect(await tmux.tmuxHasSession(`${repoName}@feature`)).toEqual({
      success: true,
      data: false,
    });
    expect(process.cwd()).toBe(safePath);
  });

  test('executes an automatic batch closure from one captured plan', async () => {
    const other = {
      repoName,
      branch: 'other',
      worktreePath: join(testDir, 'other'),
    };
    await mkdir(other.worktreePath);
    await openManagedWorkspace(target, { focus: false });
    await openManagedWorkspace(other, { focus: false });
    const plan = await planManagedWorkspaceClosure([target, other], {
      kind: 'automatic',
      candidates: [{ repoName, branch: 'main', worktreePath: safePath }],
    });
    const { output, restore } = captureStdout();

    await rm(target.worktreePath, { recursive: true });
    await rm(other.worktreePath, { recursive: true });
    await plan.execute();
    restore();

    expect(output).toEqual([
      `Killed tmux session "${repoName}@feature"\n`,
      `Killed tmux session "${repoName}@other"\n`,
    ]);
    expect(await tmux.tmuxHasSession(`${repoName}@feature`)).toEqual({
      success: true,
      data: false,
    });
    expect(await tmux.tmuxHasSession(`${repoName}@other`)).toEqual({
      success: true,
      data: false,
    });
  });

  test('selects a candidate before active automatic closure', async () => {
    await openManagedWorkspace(target, { focus: false });
    const candidate = {
      repoName,
      branch: 'main',
      worktreePath: safePath,
    };
    await openManagedWorkspace(candidate, { focus: false });
    const candidateSessionId = await getSessionId(`${repoName}@main`);
    const insideSpy = spyOn(tmux, 'isInsideTmux').mockReturnValue(true);
    const currentSpy = spyOn(tmux, 'tmuxCurrentSession').mockResolvedValue({
      success: true,
      data: `${repoName}@feature`,
    });
    const switchSpy = spyOn(tmux, 'tmuxSwitchClient').mockResolvedValue({
      success: true,
      data: undefined,
    });
    const killSpy = spyOn(tmux, 'tmuxKillSessionIfIdentity');
    const plan = await planManagedWorkspaceClosure([target], {
      kind: 'automatic',
      candidates: [candidate],
    });

    await plan.execute();

    expect(switchSpy).toHaveBeenCalledWith(candidateSessionId);
    expect(switchSpy.mock.invocationCallOrder[0]).toBeLessThan(
      killSpy.mock.invocationCallOrder[0]
    );
    expect(await tmux.tmuxHasSession(`${repoName}@feature`)).toEqual({
      success: true,
      data: false,
    });
    expect(await tmux.tmuxHasSession(`${repoName}@main`)).toEqual({
      success: true,
      data: true,
    });
    killSpy.mockRestore();
    switchSpy.mockRestore();
    currentSpy.mockRestore();
    insideSpy.mockRestore();
  });

  test('rechecks focus before active automatic closure', async () => {
    await openManagedWorkspace(target, { focus: false });
    const candidate = {
      repoName,
      branch: 'main',
      worktreePath: safePath,
    };
    await openManagedWorkspace(candidate, { focus: false });
    const candidateSessionId = await getSessionId(`${repoName}@main`);
    const insideSpy = spyOn(tmux, 'isInsideTmux').mockReturnValue(true);
    const currentSpy = spyOn(tmux, 'tmuxCurrentSession')
      .mockResolvedValueOnce({
        success: true,
        data: `${repoName}@main`,
      })
      .mockResolvedValueOnce({
        success: true,
        data: `${repoName}@feature`,
      });
    const switchSpy = spyOn(tmux, 'tmuxSwitchClient').mockResolvedValue({
      success: true,
      data: undefined,
    });
    const killSpy = spyOn(tmux, 'tmuxKillSessionIfIdentity');
    const plan = await planManagedWorkspaceClosure([target], {
      kind: 'automatic',
      candidates: [candidate],
    });

    await plan.execute();

    expect(currentSpy).toHaveBeenCalledTimes(2);
    expect(switchSpy).toHaveBeenCalledWith(candidateSessionId);
    expect(switchSpy.mock.invocationCallOrder[0]).toBeLessThan(
      killSpy.mock.invocationCallOrder[0]
    );
    killSpy.mockRestore();
    switchSpy.mockRestore();
    currentSpy.mockRestore();
    insideSpy.mockRestore();
  });

  test('does not close workspaces when focus cannot be rechecked', async () => {
    await openManagedWorkspace(target, { focus: false });
    const insideSpy = spyOn(tmux, 'isInsideTmux').mockReturnValue(true);
    const currentSpy = spyOn(tmux, 'tmuxCurrentSession')
      .mockResolvedValueOnce({
        success: true,
        data: `${repoName}@feature`,
      })
      .mockResolvedValueOnce({
        success: false,
        error: 'cannot recheck current session',
      });
    const killSpy = spyOn(tmux, 'tmuxKillSessionIfIdentity');
    const plan = await planManagedWorkspaceClosure([target], {
      kind: 'automatic',
      candidates: [],
    });

    await plan.execute();

    expect(currentSpy).toHaveBeenCalledTimes(2);
    expect(killSpy).not.toHaveBeenCalled();
    expect(await tmux.tmuxHasSession(`${repoName}@feature`)).toEqual({
      success: true,
      data: true,
    });
    killSpy.mockRestore();
    currentSpy.mockRestore();
    insideSpy.mockRestore();
  });

  test('uses a validated safe last session before automatic closure', async () => {
    await openManagedWorkspace(target, { focus: false });
    const safeLast = {
      repoName,
      branch: 'main',
      worktreePath: safePath,
    };
    await openManagedWorkspace(safeLast, { focus: false });
    const safeLastId = await getSessionId(`${repoName}@main`);
    const insideSpy = spyOn(tmux, 'isInsideTmux').mockReturnValue(true);
    const currentSpy = spyOn(tmux, 'tmuxCurrentSession').mockResolvedValue({
      success: true,
      data: `${repoName}@feature`,
    });
    const lastSessionSpy = spyOn(tmux, 'tmuxLastSession').mockResolvedValue({
      success: true,
      data: `${repoName}@main`,
    });
    const switchSpy = spyOn(tmux, 'tmuxSwitchClient').mockResolvedValue({
      success: true,
      data: undefined,
    });
    const killSpy = spyOn(tmux, 'tmuxKillSessionIfIdentity');
    const plan = await planManagedWorkspaceClosure([target], {
      kind: 'automatic',
      candidates: [],
    });

    await plan.execute();

    expect(lastSessionSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith(safeLastId);
    expect(switchSpy.mock.invocationCallOrder[0]).toBeLessThan(
      killSpy.mock.invocationCallOrder[0]
    );
    killSpy.mockRestore();
    switchSpy.mockRestore();
    lastSessionSpy.mockRestore();
    currentSpy.mockRestore();
    insideSpy.mockRestore();
  });

  test('creates a fresh session when the last session is also closing', async () => {
    const other = {
      repoName,
      branch: 'other',
      worktreePath: join(testDir, 'other'),
    };
    await mkdir(other.worktreePath);
    await openManagedWorkspace(target, { focus: false });
    await openManagedWorkspace(other, { focus: false });
    const insideSpy = spyOn(tmux, 'isInsideTmux').mockReturnValue(true);
    const currentSpy = spyOn(tmux, 'tmuxCurrentSession').mockResolvedValue({
      success: true,
      data: `${repoName}@feature`,
    });
    const lastSessionSpy = spyOn(tmux, 'tmuxLastSession').mockResolvedValue({
      success: true,
      data: `${repoName}@other`,
    });
    const switchLastSpy = spyOn(tmux, 'tmuxSwitchClientLast').mockResolvedValue(
      { success: true, data: undefined }
    );
    const freshSession = `${repoName}@fresh`;
    transientSessions.push(freshSession);
    const freshSpy = spyOn(tmux, 'tmuxNewSessionDefault').mockImplementation(
      async () => {
        const created = await tmux.tmuxNewSession(freshSession, safePath);
        if (!created.success) return created;
        return { success: true, data: freshSession };
      }
    );
    const switchSpy = spyOn(tmux, 'tmuxSwitchClient').mockResolvedValue({
      success: true,
      data: undefined,
    });
    const killSpy = spyOn(tmux, 'tmuxKillSessionIfIdentity');
    const plan = await planManagedWorkspaceClosure([target, other], {
      kind: 'automatic',
      candidates: [],
    });

    await plan.execute();

    const freshSessionId = await getSessionId(freshSession);
    expect(switchLastSpy).not.toHaveBeenCalled();
    expect(freshSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith(freshSessionId);
    expect(switchSpy.mock.invocationCallOrder[0]).toBeLessThan(
      killSpy.mock.invocationCallOrder[0]
    );
    killSpy.mockRestore();
    switchSpy.mockRestore();
    freshSpy.mockRestore();
    switchLastSpy.mockRestore();
    lastSessionSpy.mockRestore();
    currentSpy.mockRestore();
    insideSpy.mockRestore();
  });

  test('does not close a replacement session that reuses a planned name', async () => {
    await openManagedWorkspace(target, { focus: false });
    const sessionName = `${repoName}@feature`;
    const plan = await planManagedWorkspaceClosure([target], {
      kind: 'preserve',
      destination: { path: safePath },
    });
    await tmux.tmuxKillSession(sessionName);
    await tmux.tmuxNewSession(sessionName, safePath);
    const killSpy = spyOn(tmux, 'tmuxKillSessionIfIdentity');

    await plan.execute();

    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(await tmux.tmuxHasSession(sessionName)).toEqual({
      success: true,
      data: true,
    });
    killSpy.mockRestore();
  });

  test('does not close a fresh session that reuses a planned name', async () => {
    await openManagedWorkspace(target, { focus: false });
    const other = {
      repoName,
      branch: 'other',
      worktreePath: join(testDir, 'other'),
    };
    await mkdir(other.worktreePath);
    const initialSession = await tmux.tmuxNewSessionDefault(other.worktreePath);
    if (!initialSession.success) throw new Error(initialSession.error);
    const reusedName = initialSession.data;
    transientSessions.push(reusedName);
    const insideSpy = spyOn(tmux, 'isInsideTmux').mockReturnValue(true);
    const currentSpy = spyOn(tmux, 'tmuxCurrentSession').mockResolvedValue({
      success: true,
      data: `${repoName}@feature`,
    });
    const lastSessionSpy = spyOn(tmux, 'tmuxLastSession').mockResolvedValue({
      success: true,
      data: reusedName,
    });
    const plan = await planManagedWorkspaceClosure([target, other], {
      kind: 'automatic',
      candidates: [],
    });
    await tmux.tmuxKillSession(reusedName);
    const freshSpy = spyOn(tmux, 'tmuxNewSessionDefault').mockImplementation(
      async () => {
        const created = await tmux.tmuxNewSession(reusedName, safePath);
        if (!created.success) return created;
        return { success: true, data: reusedName };
      }
    );
    const switchSpy = spyOn(tmux, 'tmuxSwitchClient').mockResolvedValue({
      success: true,
      data: undefined,
    });
    const killSpy = spyOn(tmux, 'tmuxKillSessionIfIdentity');

    await plan.execute();

    const freshSessionId = await getSessionId(reusedName);
    expect(switchSpy).toHaveBeenCalledWith(freshSessionId);
    expect(killSpy).toHaveBeenCalledTimes(2);
    expect(await tmux.tmuxHasSession(reusedName)).toEqual({
      success: true,
      data: true,
    });
    killSpy.mockRestore();
    switchSpy.mockRestore();
    freshSpy.mockRestore();
    lastSessionSpy.mockRestore();
    currentSpy.mockRestore();
    insideSpy.mockRestore();
  });

  test('moves focus to a destination before closing the active workspace', async () => {
    await openManagedWorkspace(target, { focus: false });
    const destination = {
      repoName,
      branch: 'main',
      worktreePath: safePath,
    };
    const insideSpy = spyOn(tmux, 'isInsideTmux').mockReturnValue(true);
    const openSpy = spyOn(tmux, 'openTmuxSession').mockResolvedValue();
    const killSpy = spyOn(tmux, 'tmuxKillSessionIfIdentity');
    const plan = await planManagedWorkspaceClosure([target], {
      kind: 'destination',
      target: destination,
    });

    await rm(target.worktreePath, { recursive: true });
    await plan.execute();

    expect(await tmux.tmuxHasSession(`${repoName}@feature`)).toEqual({
      success: true,
      data: false,
    });
    expect(openSpy.mock.invocationCallOrder[0]).toBeLessThan(
      killSpy.mock.invocationCallOrder[0]
    );
    expect(process.cwd()).toBe(safePath);
    killSpy.mockRestore();
    openSpy.mockRestore();
    insideSpy.mockRestore();
  });
});
