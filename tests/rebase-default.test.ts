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

async function captureExit(command: () => Promise<void>) {
  const mockExit = mockProcessExit();
  try {
    return await captureOutput(command);
  } finally {
    mockExit.mockRestore();
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

  for (const relationship of ['recorded', 'implicit'] as const) {
    for (const state of ['behind', 'ahead', 'diverged'] as const) {
      test(`uses the newest default head when ${relationship} parent is ${state}`, async () => {
        const scenario = await createScenario(root);
        if (state !== 'behind') {
          await commitFile(
            scenario.local,
            'local.txt',
            'local',
            'local update'
          );
        }
        const feature = join(root, 'feature');
        await runGitCommand(
          ['worktree', 'add', '-b', 'feature', feature],
          scenario.local
        );
        await commitFile(feature, 'feature.txt', 'feature', 'feature');
        if (relationship === 'recorded') {
          await writeConfig(scenario.configPath, {
            repos: [
              {
                name: 'local',
                url: scenario.remote,
                path: scenario.local,
                stacks: [{ parent: 'trunk', child: 'feature' }],
              },
            ],
          });
        }
        await cloneUpdater(scenario.remote, scenario.updater);
        if (state !== 'ahead') {
          await commitFile(
            scenario.updater,
            'remote.txt',
            'remote',
            'remote update'
          );
          await runGitCommand(['push', 'origin', 'trunk'], scenario.updater);
        }
        process.chdir(feature);
        const result = await captureOutput(() =>
          rebaseCommand({ configPath: scenario.configPath })
        );
        if (result.error) throw result.error;
        const expectedDefaultLog =
          state === 'ahead' ? 'local update\nbase' : 'remote update\nbase';
        expect(
          (await runGitCommand(['log', '--format=%s', 'trunk'], feature)).stdout
        ).toEqual(expectedDefaultLog);
        expect(
          (await runGitCommand(['log', '--format=%s'], feature)).stdout
        ).toEqual(`feature\n${expectedDefaultLog}`);
        const defaultHead = (
          await runGitCommand(['rev-parse', 'trunk'], feature)
        ).stdout;
        expect(await getForkPoint(scenario.local, 'feature')).toEqual({
          success: true,
          data: defaultHead,
        });
        expect(
          (await runGitCommand(['status', '--porcelain'], scenario.local))
            .stdout
        ).toEqual('');
        expect(
          existsSync(
            join(scenario.local, state === 'ahead' ? 'local.txt' : 'remote.txt')
          )
        ).toEqual(true);
      });
    }
  }

  test('uses a non-default parent local head without updating it from upstream', async () => {
    const scenario = await createScenario(root);
    const parent = join(root, 'parent');
    const feature = join(root, 'feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'parent', parent],
      scenario.local
    );
    await commitFile(parent, 'parent.txt', 'parent', 'parent');
    await runGitCommand(['push', '-u', 'origin', 'parent'], parent);
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', feature, 'parent'],
      scenario.local
    );
    await commitFile(feature, 'feature.txt', 'feature', 'feature');
    await commitFile(parent, 'local.txt', 'local', 'local parent update');
    await cloneUpdater(scenario.remote, scenario.updater);
    await runGitCommand(['checkout', 'parent'], scenario.updater);
    await commitFile(
      scenario.updater,
      'remote.txt',
      'remote',
      'remote parent update'
    );
    await runGitCommand(['push', 'origin', 'parent'], scenario.updater);
    await writeConfig(scenario.configPath, {
      repos: [
        {
          name: 'local',
          url: scenario.remote,
          path: scenario.local,
          stacks: [{ parent: 'parent', child: 'feature' }],
        },
      ],
    });
    process.chdir(feature);
    const result = await captureOutput(() =>
      rebaseCommand({ configPath: scenario.configPath })
    );
    if (result.error) throw result.error;
    expect(
      (await runGitCommand(['log', '--format=%s'], feature)).stdout
    ).toEqual('feature\nlocal parent update\nparent\nbase');
    expect(
      (await runGitCommand(['log', '--format=%s'], parent)).stdout
    ).toEqual('local parent update\nparent\nbase');
  });

  for (const state of ['behind', 'ahead', 'diverged', 'missing'] as const) {
    test(`handles a ${state} local default without a checked-out default worktree`, async () => {
      const scenario = await createScenario(root);
      if (state === 'ahead' || state === 'diverged') {
        await commitFile(scenario.local, 'local.txt', 'local', 'local update');
      }
      const feature = join(root, 'feature');
      await runGitCommand(
        ['worktree', 'add', '-b', 'feature', feature],
        scenario.local
      );
      await commitFile(feature, 'feature.txt', 'feature', 'feature');
      await runGitCommand(['checkout', '--detach'], scenario.local);
      if (state === 'missing') {
        await runGitCommand(['branch', '-D', 'trunk'], scenario.local);
      }
      await cloneUpdater(scenario.remote, scenario.updater);
      if (state !== 'ahead') {
        await commitFile(
          scenario.updater,
          'remote.txt',
          'remote',
          'remote update'
        );
        await runGitCommand(['push', 'origin', 'trunk'], scenario.updater);
      }
      process.chdir(feature);
      const result = await captureOutput(() =>
        rebaseCommand({ configPath: scenario.configPath })
      );
      if (result.error) throw result.error;
      const expected =
        state === 'ahead' ? 'local update\nbase' : 'remote update\nbase';
      expect(
        (await runGitCommand(['log', '--format=%s'], feature)).stdout
      ).toEqual(`feature\n${expected}`);
      const target = state === 'missing' ? 'origin/trunk' : 'trunk';
      expect(
        (await runGitCommand(['log', '--format=%s', target], feature)).stdout
      ).toEqual(expected);
    });
  }

  for (const obstruction of [
    'uncommitted changes',
    'merge',
    'rebase',
  ] as const) {
    test(`does not update main or feature when main has ${obstruction}`, async () => {
      const scenario = await createScenario(root);
      const feature = join(root, 'feature');
      await runGitCommand(
        ['worktree', 'add', '-b', 'feature', feature],
        scenario.local
      );
      await commitFile(feature, 'feature.txt', 'feature', 'feature');
      await cloneUpdater(scenario.remote, scenario.updater);
      await commitFile(scenario.updater, 'base.txt', 'remote', 'remote update');
      await runGitCommand(['push', 'origin', 'trunk'], scenario.updater);
      const upstreamHead = (
        await runGitCommand(['rev-parse', 'HEAD'], scenario.updater)
      ).stdout;
      if (obstruction === 'uncommitted changes') {
        await Bun.write(join(scenario.local, 'base.txt'), 'uncommitted');
      } else {
        await commitFile(scenario.local, 'base.txt', 'local', 'local update');
        await runGitCommand(['fetch', 'origin'], scenario.local);
        const operation =
          obstruction === 'merge'
            ? ['merge', 'origin/trunk']
            : ['rebase', 'origin/trunk'];
        await runGitCommand(operation, scenario.local);
      }
      const mainHead = (
        await runGitCommand(['rev-parse', 'trunk'], scenario.local)
      ).stdout;
      const featureHead = (await runGitCommand(['rev-parse', 'HEAD'], feature))
        .stdout;
      const status = (
        await runGitCommand(['status', '--porcelain'], scenario.local)
      ).stdout;
      const contents = await Bun.file(join(scenario.local, 'base.txt')).text();
      process.chdir(feature);
      const result = await captureExit(() =>
        rebaseCommand({ configPath: scenario.configPath })
      );
      expect(result.error).toEqual(new Error('process.exit(1)'));
      expect(result.stderr).toEqual(
        `Error: Cannot update "trunk": worktree has ${obstruction === 'uncommitted changes' ? obstruction : `an in-progress ${obstruction}`}\n`
      );
      expect(
        (await runGitCommand(['rev-parse', 'trunk'], scenario.local)).stdout
      ).toEqual(mainHead);
      expect(
        (await runGitCommand(['rev-parse', 'HEAD'], feature)).stdout
      ).toEqual(featureHead);
      expect(
        (await runGitCommand(['status', '--porcelain'], scenario.local)).stdout
      ).toEqual(status);
      expect(await Bun.file(join(scenario.local, 'base.txt')).text()).toEqual(
        contents
      );
      expect(
        (await runGitCommand(['rev-parse', 'origin/trunk'], feature)).stdout
      ).toEqual(upstreamHead);
    });
  }

  test('preserves child boundaries before replacing a divergent default with --only', async () => {
    const scenario = await createScenario(root);
    await commitFile(scenario.local, 'local.txt', 'local', 'local update');
    const feature = join(root, 'feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', feature],
      scenario.local
    );
    await commitFile(feature, 'feature.txt', 'feature', 'feature');
    await writeConfig(scenario.configPath, {
      repos: [
        {
          name: 'local',
          url: scenario.remote,
          path: scenario.local,
          stacks: [{ parent: 'trunk', child: 'feature' }],
        },
      ],
    });
    const featureHead = (await runGitCommand(['rev-parse', 'HEAD'], feature))
      .stdout;
    await cloneUpdater(scenario.remote, scenario.updater);
    await commitFile(scenario.updater, 'remote.txt', 'remote', 'remote update');
    await runGitCommand(['push', 'origin', 'trunk'], scenario.updater);
    const ctx = { configPath: scenario.configPath };
    const update = await captureOutput(() =>
      rebaseCommand(ctx, 'trunk', 'local', { only: true })
    );
    if (update.error) throw update.error;
    expect(
      (await runGitCommand(['rev-parse', 'HEAD'], feature)).stdout
    ).toEqual(featureHead);
    const rebase = await captureOutput(() =>
      rebaseCommand(ctx, 'feature', 'local')
    );
    if (rebase.error) throw rebase.error;
    expect(
      (await runGitCommand(['log', '--format=%s'], feature)).stdout
    ).toEqual('feature\nremote update\nbase');
  });

  test('preserves implicit siblings before replacing a divergent default', async () => {
    const scenario = await createScenario(root);
    await commitFile(scenario.local, 'local.txt', 'local', 'local update');
    const siblings = [join(root, 'feature-a'), join(root, 'feature-b')];
    for (const [index, feature] of siblings.entries()) {
      await runGitCommand(
        ['worktree', 'add', '-b', `feature-${index}`, feature, 'trunk'],
        scenario.local
      );
      await commitFile(
        feature,
        `feature-${index}.txt`,
        'feature',
        `feature ${index}`
      );
    }
    await cloneUpdater(scenario.remote, scenario.updater);
    await commitFile(scenario.updater, 'remote.txt', 'remote', 'remote update');
    await runGitCommand(['push', 'origin', 'trunk'], scenario.updater);
    for (const [index, feature] of siblings.entries()) {
      process.chdir(feature);
      const result = await captureOutput(() =>
        rebaseCommand({ configPath: scenario.configPath })
      );
      if (result.error) throw result.error;
      expect(
        (await runGitCommand(['log', '--format=%s'], feature)).stdout
      ).toEqual(`feature ${index}\nremote update\nbase`);
    }
  });

  test('does not let an unrelated orphan worktree block a feature rebase', async () => {
    const scenario = await createScenario(root);
    const feature = join(root, 'feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', feature],
      scenario.local
    );
    await commitFile(feature, 'feature.txt', 'feature', 'feature');
    const site = join(root, 'site');
    await runGitCommand(['worktree', 'add', '--detach', site], scenario.local);
    await runGitCommand(['checkout', '--orphan', 'site'], site);
    await runGitCommand(['rm', '-rf', '.'], site);
    await commitFile(site, 'index.html', 'site', 'site root');
    const siteHead = (await runGitCommand(['rev-parse', 'HEAD'], site)).stdout;
    await cloneUpdater(scenario.remote, scenario.updater);
    await commitFile(scenario.updater, 'remote.txt', 'remote', 'remote update');
    await runGitCommand(['push', 'origin', 'trunk'], scenario.updater);
    process.chdir(feature);
    const result = await captureExit(() =>
      rebaseCommand({ configPath: scenario.configPath })
    );
    if (result.error) throw result.error;
    expect(
      (await runGitCommand(['log', '--format=%s'], feature)).stdout
    ).toEqual('feature\nremote update\nbase');
    expect((await runGitCommand(['rev-parse', 'HEAD'], site)).stdout).toEqual(
      siteHead
    );
  });

  test('continues an implicit-parent conflict using the ahead local default fork point', async () => {
    const scenario = await createScenario(root);
    const feature = join(root, 'feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', feature],
      scenario.local
    );
    await commitFile(feature, 'base.txt', 'feature', 'feature conflict');
    await commitFile(scenario.local, 'base.txt', 'local', 'local update');
    const ctx = { configPath: scenario.configPath };
    process.chdir(feature);
    const result = await captureExit(() => rebaseCommand(ctx));
    expect(result.error).toEqual(new Error('process.exit(1)'));
    await Bun.write(join(feature, 'base.txt'), 'resolved');
    await runGitCommand(['add', 'base.txt'], feature);
    expect(await captureOutput(() => continueCommand(ctx))).toEqual({
      stdout:
        'Continuing rebase...\nUpdated fork point reference.\nRebase completed successfully.\n',
      stderr: '',
    });
    const localHead = (await runGitCommand(['rev-parse', 'trunk'], feature))
      .stdout;
    expect(await getForkPoint(scenario.local, 'feature')).toEqual({
      success: true,
      data: localHead,
    });
    expect(
      (await runGitCommand(['log', '--format=%s'], feature)).stdout
    ).toEqual('feature conflict\nlocal update\nbase');
  });

  test('updates defaults and preserves the Branch Stack contracts', async () => {
    // Use upstream on a divergent non-main default branch; preserve its refs.
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
    ).toEqual('remote update\nbase');
    expect(await getForkPoint(scenario.local, 'trunk')).toEqual({
      success: true,
      data: oldForkPoint,
    });
    expect(existsSync(join(scenario.local, 'local.txt'))).toBe(false);
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
    ).toEqual('replacement upstream\nbase');
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

    // Continue a conflicting child rebase after updating the default branch.
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
    await commitFile(conflictChild, 'base.txt', 'child', 'conflict child');
    const grandchild = join(root, 'grandchild');
    await runGitCommand(
      ['worktree', 'add', '-b', 'grandchild', grandchild, 'conflict-child'],
      scenario.local
    );
    await commitFile(grandchild, 'grandchild.txt', 'grandchild', 'grandchild');
    await runGitCommand(
      ['update-ref', 'refs/bases/grandchild', 'conflict-child'],
      scenario.local
    );
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
          stacks: [
            { parent: 'trunk', child: 'conflict-child' },
            { parent: 'conflict-child', child: 'grandchild' },
          ],
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
        'Updating "trunk" from "origin/trunk"...\n' +
        'Updated "trunk" from "origin/trunk"\n' +
        'Rebasing "conflict-child" on parent branch "trunk"...\n'
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
    await Bun.write(join(conflictChild, 'base.txt'), 'resolved');
    await runGitCommand(['add', 'base.txt'], conflictChild);
    process.chdir(conflictChild);
    expect(await captureOutput(() => continueCommand(ctx))).toEqual({
      stdout:
        'Continuing rebase...\n' +
        'Updated fork point reference.\n' +
        'Rebase completed successfully.\n' +
        'Rebasing 1 remaining branch(es)...\n' +
        'Rebasing "grandchild" on parent branch "conflict-child"...\n' +
        'Rebased "grandchild" on "conflict-child"\n',
      stderr: '',
    });
    expect(
      (await runGitCommand(['log', '--format=%s'], conflictChild)).stdout
    ).toEqual('conflict child\nremote conflict\nbase');
    expect(await getForkPoint(scenario.local, 'trunk')).toEqual({
      success: false,
      error: 'No base ref found for branch "trunk"',
    });
  });
});
