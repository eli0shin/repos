import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as tmux from '../src/tmux.ts';
import {
  openManagedWorkspace,
  planManagedWorkspaceClosure,
  type ManagedWorkspaceTarget,
} from '../src/workspace-manager/index.ts';

const testDir = `/tmp/repos-test-workspace-manager-${process.pid}`;
const repoName = `repos-test-workspace-manager-${process.pid}`;
const sessions = [
  `${repoName}@feature`,
  `${repoName}@other`,
  `${repoName}@main`,
];

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

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    safePath = join(testDir, 'safe');
    const worktreePath = join(testDir, 'feature');
    await mkdir(safePath, { recursive: true });
    await mkdir(worktreePath, { recursive: true });
    target = { repoName, branch: 'feature', worktreePath };
    for (const session of sessions) await tmux.tmuxKillSession(session);
  });

  afterEach(async () => {
    process.chdir('/tmp');
    for (const session of sessions) await tmux.tmuxKillSession(session);
    await rm(testDir, { recursive: true, force: true });
  });

  test('opens and reuses a Managed Workspace without changing focus', async () => {
    await openManagedWorkspace(target, { focus: false });
    await openManagedWorkspace(target, { focus: false });

    expect(await tmux.tmuxHasSession(`${repoName}@feature`)).toEqual({
      success: true,
      data: true,
    });
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

  test('moves focus to a destination before closing the active workspace', async () => {
    await openManagedWorkspace(target, { focus: false });
    const destination = {
      repoName,
      branch: 'main',
      worktreePath: safePath,
    };
    const insideSpy = spyOn(tmux, 'isInsideTmux').mockReturnValue(true);
    const openSpy = spyOn(tmux, 'openTmuxSession').mockResolvedValue();
    const killSpy = spyOn(tmux, 'tmuxKillSession');
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
