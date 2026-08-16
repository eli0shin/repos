import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getForkPoint } from '../src/branch-stack/index.ts';
import { continueCommand } from '../src/commands/continue.ts';
import { rebaseCommand } from '../src/commands/rebase.ts';
import { writeConfig } from '../src/config.ts';
import { runGitCommand } from '../src/git/index.ts';
import { mockProcessExit } from './utils.ts';

async function captureOutput(
  command: () => Promise<void>
): Promise<{ stdout: string; stderr: string; error?: Error }> {
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  let stdout = '';
  let stderr = '';
  process.stdout.write = (chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  };
  process.stderr.write = (chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  };

  try {
    await command();
    return { stdout, stderr };
  } catch (error) {
    return {
      stdout,
      stderr,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
}

async function commitFile(
  repo: string,
  file: string,
  content: string,
  message: string
): Promise<void> {
  await Bun.write(join(repo, file), content);
  await runGitCommand(['add', file], repo);
  await runGitCommand(['commit', '-m', message], repo);
}

async function createScenario(root: string): Promise<{
  remote: string;
  local: string;
  updater: string;
  configPath: string;
}> {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const remote = join(root, 'remote.git');
  const local = join(root, 'local');
  const updater = join(root, 'updater');
  const configPath = join(root, 'config.json');
  await mkdir(remote, { recursive: true });
  await runGitCommand(['init', '--bare', '-b', 'trunk'], remote);
  await runGitCommand(['clone', remote, local]);
  await runGitCommand(['config', 'user.email', 'test@test.com'], local);
  await runGitCommand(['config', 'user.name', 'Test'], local);
  await commitFile(local, 'base.txt', 'base', 'base');
  await runGitCommand(['push', '-u', 'origin', 'trunk'], local);
  await writeConfig(configPath, {
    repos: [{ name: 'local', url: remote, path: local }],
  });
  return { remote, local, updater, configPath };
}

async function cloneUpdater(remote: string, updater: string): Promise<void> {
  await runGitCommand(['clone', remote, updater]);
  await runGitCommand(['config', 'user.email', 'test@test.com'], updater);
  await runGitCommand(['config', 'user.name', 'Test'], updater);
}

describe('repos rebase default branch updates', () => {
  const root = '/tmp/repos-test-rebase-default';
  const originalCwd = process.cwd();

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  });

  test('updates defaults and preserves the Branch Stack contracts', async () => {
    // Update a non-main default branch and preserve local-only commits and refs.
    let scenario = await createScenario(root);
    let ctx = { configPath: scenario.configPath };
    await cloneUpdater(scenario.remote, scenario.updater);
    await commitFile(scenario.updater, 'remote.txt', 'remote', 'remote update');
    await runGitCommand(['push', 'origin', 'trunk'], scenario.updater);
    await commitFile(scenario.local, 'local.txt', 'local', 'local update');
    const oldForkPoint = (
      await runGitCommand(['rev-parse', 'HEAD^'], scenario.local)
    ).stdout;
    await runGitCommand(
      ['update-ref', 'refs/bases/trunk', oldForkPoint],
      scenario.local
    );

    expect(
      await captureOutput(() => rebaseCommand(ctx, 'trunk', 'local'))
    ).toEqual({
      stdout:
        'Updating "trunk" from "origin/trunk"...\n' +
        'Updated "trunk" from "origin/trunk"\n',
      stderr: '',
    });
    expect(
      (await runGitCommand(['log', '--format=%s'], scenario.local)).stdout
    ).toEqual('local update\nremote update\nbase');
    expect(await getForkPoint(scenario.local, 'trunk')).toEqual({
      success: true,
      data: oldForkPoint,
    });
    expect(existsSync(join(scenario.local, 'local.txt'))).toBe(true);
    expect(existsSync(join(scenario.local, 'remote.txt'))).toBe(true);
    expect(
      await captureOutput(() => rebaseCommand(ctx, 'trunk', 'local'))
    ).toEqual({
      stdout:
        'Updating "trunk" from "origin/trunk"...\n' +
        'Updated "trunk" from "origin/trunk"\n',
      stderr: '',
    });

    // Do not replay upstream commits that a force-push removed.
    scenario = await createScenario(root);
    ctx = { configPath: scenario.configPath };
    await cloneUpdater(scenario.remote, scenario.updater);
    await commitFile(
      scenario.updater,
      'discarded.txt',
      'discarded',
      'discarded upstream'
    );
    await runGitCommand(['push', 'origin', 'trunk'], scenario.updater);
    await runGitCommand(['fetch', 'origin'], scenario.local);
    await runGitCommand(['merge', '--ff-only', 'origin/trunk'], scenario.local);
    await commitFile(scenario.local, 'local.txt', 'local', 'local only');
    await runGitCommand(['reset', '--hard', 'HEAD^'], scenario.updater);
    await commitFile(
      scenario.updater,
      'replacement.txt',
      'replacement',
      'replacement upstream'
    );
    await runGitCommand(
      ['push', '--force', 'origin', 'trunk'],
      scenario.updater
    );

    expect(
      await captureOutput(() => rebaseCommand(ctx, 'trunk', 'local'))
    ).toEqual({
      stdout:
        'Updating "trunk" from "origin/trunk"...\n' +
        'Updated "trunk" from "origin/trunk"\n',
      stderr: '',
    });
    expect(
      (await runGitCommand(['log', '--format=%s'], scenario.local)).stdout
    ).toEqual('local only\nreplacement upstream\nbase');
    expect(existsSync(join(scenario.local, 'discarded.txt'))).toBe(false);

    // Rebase descendants by default, but not with --only.
    scenario = await createScenario(root);
    ctx = { configPath: scenario.configPath };
    const child = join(root, 'child');
    await runGitCommand(
      ['worktree', 'add', '-b', 'child', child],
      scenario.local
    );
    await commitFile(child, 'child.txt', 'child', 'child');
    const initialHead = (
      await runGitCommand(['rev-parse', 'trunk'], scenario.local)
    ).stdout;
    await runGitCommand(
      ['update-ref', 'refs/bases/child', initialHead],
      scenario.local
    );
    await writeConfig(scenario.configPath, {
      repos: [
        {
          name: 'local',
          url: scenario.remote,
          path: scenario.local,
          stacks: [{ parent: 'trunk', child: 'child' }],
        },
      ],
    });
    await cloneUpdater(scenario.remote, scenario.updater);
    await commitFile(scenario.updater, 'one.txt', 'one', 'remote one');
    await runGitCommand(['push', 'origin', 'trunk'], scenario.updater);

    expect(
      await captureOutput(() => rebaseCommand(ctx, 'trunk', 'local'))
    ).toEqual({
      stdout:
        'Will rebase "trunk" and 1 child branch(es)...\n' +
        'Updating "trunk" from "origin/trunk"...\n' +
        'Updated "trunk" from "origin/trunk"\n' +
        'Rebasing "child" on parent branch "trunk"...\n' +
        'Rebased "child" on "trunk"\n',
      stderr: '',
    });
    expect((await runGitCommand(['log', '--format=%s'], child)).stdout).toEqual(
      'child\nremote one\nbase'
    );

    await commitFile(scenario.updater, 'two.txt', 'two', 'remote two');
    await runGitCommand(['push', 'origin', 'trunk'], scenario.updater);
    expect(
      await captureOutput(() =>
        rebaseCommand(ctx, 'trunk', 'local', { only: true })
      )
    ).toEqual({
      stdout:
        'Updating "trunk" from "origin/trunk"...\n' +
        'Updated "trunk" from "origin/trunk"\n',
      stderr: '',
    });
    expect((await runGitCommand(['log', '--format=%s'], child)).stdout).toEqual(
      'child\nremote one\nbase'
    );
    expect(
      (await runGitCommand(['log', '--format=%s'], scenario.local)).stdout
    ).toEqual('remote two\nremote one\nbase');

    // Do not infer a selected feature branch when the remote HEAD is invalid.
    scenario = await createScenario(root);
    ctx = { configPath: scenario.configPath };
    await runGitCommand(
      ['symbolic-ref', 'HEAD', 'refs/heads/missing'],
      scenario.remote
    );
    const feature = join(root, 'feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', feature],
      scenario.local
    );
    await commitFile(feature, 'feature.txt', 'feature', 'feature');
    const featureHead = (await runGitCommand(['rev-parse', 'HEAD'], feature))
      .stdout;
    const mockExit = mockProcessExit();
    expect(
      await captureOutput(() => rebaseCommand(ctx, 'feature', 'local'))
    ).toEqual({
      stdout: '',
      stderr:
        'Error: Could not determine the remote default branch from origin/HEAD\n',
      error: new Error('process.exit(1)'),
    });
    mockExit.mockRestore();
    expect((await runGitCommand(['rev-parse', 'HEAD'], feature)).stdout).toBe(
      featureHead
    );
    expect(await getForkPoint(scenario.local, 'feature')).toEqual({
      success: false,
      error: 'No base ref found for branch "feature"',
    });

    // Continue a conflicting default update without recording a Fork Point.
    scenario = await createScenario(root);
    ctx = { configPath: scenario.configPath };
    await cloneUpdater(scenario.remote, scenario.updater);
    await commitFile(scenario.updater, 'base.txt', 'remote', 'remote conflict');
    await runGitCommand(['push', 'origin', 'trunk'], scenario.updater);
    await commitFile(scenario.local, 'base.txt', 'local', 'local conflict');
    const conflictChild = join(root, 'conflict-child');
    await runGitCommand(
      ['worktree', 'add', '-b', 'conflict-child', conflictChild],
      scenario.local
    );
    await commitFile(conflictChild, 'child.txt', 'child', 'conflict child');
    const conflictForkPoint = (
      await runGitCommand(['rev-parse', 'trunk'], scenario.local)
    ).stdout;
    await runGitCommand(
      ['update-ref', 'refs/bases/conflict-child', conflictForkPoint],
      scenario.local
    );
    await writeConfig(scenario.configPath, {
      repos: [
        {
          name: 'local',
          url: scenario.remote,
          path: scenario.local,
          stacks: [{ parent: 'trunk', child: 'conflict-child' }],
        },
      ],
    });
    const conflictExit = mockProcessExit();
    const conflictResult = await captureOutput(() =>
      rebaseCommand(ctx, 'trunk', 'local')
    );
    expect(conflictResult.error).toEqual(new Error('process.exit(1)'));
    expect(conflictResult.stdout).toEqual(
      'Will rebase "trunk" and 1 child branch(es)...\n' +
        'Updating "trunk" from "origin/trunk"...\n'
    );
    expect(conflictResult.stderr).toEqual(
      'Error: Rebase paused due to conflicts.\n\n' +
        'To resolve:\n' +
        '  1. Fix conflicts in the affected files\n' +
        '  2. Stage resolved files: git add <file>\n' +
        '  3. Continue rebase: repos continue\n\n' +
        'To abort: git rebase --abort\n'
    );
    conflictExit.mockRestore();

    await rename(scenario.remote, join(root, 'remote-unavailable.git'));
    await Bun.write(join(scenario.local, 'base.txt'), 'resolved');
    await runGitCommand(['add', 'base.txt'], scenario.local);
    process.chdir(scenario.local);
    expect(await captureOutput(() => continueCommand(ctx))).toEqual({
      stdout:
        'Continuing rebase...\n' +
        'Rebase completed successfully.\n' +
        'Rebasing 1 remaining branch(es)...\n' +
        'Rebasing "conflict-child" on parent branch "trunk"...\n' +
        'Rebased "conflict-child" on "trunk"\n',
      stderr: '',
    });
    expect(
      (await runGitCommand(['log', '--format=%s'], conflictChild)).stdout
    ).toEqual('conflict child\nlocal conflict\nremote conflict\nbase');
    expect(await getForkPoint(scenario.local, 'trunk')).toEqual({
      success: false,
      error: 'No base ref found for branch "trunk"',
    });
  });
});
