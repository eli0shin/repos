import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  spyOn,
  type Mock,
} from 'bun:test';
import { mkdir, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { runGitCommand, cloneBare, isGitRepo } from '../src/git/index.ts';
import { cleanupCommand } from '../src/commands/cleanup.ts';
import { listCommand } from '../src/commands/list.ts';
import { writeConfig } from '../src/config.ts';
import * as github from '../src/github.ts';
import type { ReposConfig } from '../src/types.ts';

// Helper to create a test repo with commits
async function createTestRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await runGitCommand(['init'], dir);
  await Bun.write(join(dir, 'test.txt'), 'test');
  await runGitCommand(['add', '.'], dir);
  await runGitCommand(['commit', '-m', 'initial'], dir);
}

// Helper to capture stdout
function captureStdout(): { output: string[]; restore: () => void } {
  const output: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string) => {
    output.push(chunk);
    return true;
  };
  return {
    output,
    restore: () => {
      process.stdout.write = originalWrite;
    },
  };
}

describe('repos cleanup command', () => {
  const testDir = '/tmp/repos-test-cleanup-cmd';
  const sourceDir = '/tmp/repos-test-cleanup-cmd-source';
  const configPath = '/tmp/repos-test-cleanup-cmd-config/config.json';
  let originalCwd: string;
  let getPullRequestStatusSpy: Mock<typeof github.getPullRequestStatus>;

  beforeEach(async () => {
    originalCwd = process.cwd();
    getPullRequestStatusSpy = spyOn(
      github,
      'getPullRequestStatus'
    ).mockResolvedValue(undefined);
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    getPullRequestStatusSpy.mockRestore();
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-cleanup-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('removes worktree when upstream is deleted', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create worktree with tracking branch
    const worktreePath = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    // Push the branch to origin so it has upstream
    await Bun.write(join(worktreePath, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath);
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath);

    // Delete the remote branch to simulate PR merge
    await runGitCommand(['branch', '-D', 'feature'], sourceDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Verify worktree exists before
    expect(await isGitRepo(worktreePath)).toBe(true);

    // Run cleanup command
    const ctx = { configPath };
    await cleanupCommand(ctx, { dryRun: false, tmux: false });

    // Verify worktree was removed
    expect(await isGitRepo(worktreePath)).toBe(false);
  });

  test('removes worktree when branch is merged into main', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create worktree
    const worktreePath = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    // Make a commit on feature
    await Bun.write(join(worktreePath, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath);

    // Push to origin with tracking (required for cleanup to recognize as tracking)
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath);

    // Merge feature into main on the source (simulating PR merge)
    await runGitCommand(['merge', 'feature', '-m', 'merge feature'], sourceDir);

    // Fetch to get the merged main
    await runGitCommand(['fetch', 'origin'], bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Verify worktree exists before
    expect(await isGitRepo(worktreePath)).toBe(true);

    // Run cleanup command
    const ctx = { configPath };
    await cleanupCommand(ctx, { dryRun: false, tmux: false });

    // Verify worktree was removed
    expect(await isGitRepo(worktreePath)).toBe(false);
  });

  test('skips worktree with uncommitted changes', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create worktree with tracking
    const worktreePath = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    // Push the branch
    await Bun.write(join(worktreePath, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath);
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath);

    // Delete remote branch
    await runGitCommand(['branch', '-D', 'feature'], sourceDir);

    // Add uncommitted changes
    await Bun.write(join(worktreePath, 'dirty.txt'), 'dirty');

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run cleanup command
    const capture = captureStdout();
    const ctx = { configPath };
    await cleanupCommand(ctx, { dryRun: false, tmux: false });
    capture.restore();

    // Verify worktree still exists (not removed due to uncommitted changes)
    expect(await isGitRepo(worktreePath)).toBe(true);

    // Verify warning was output
    expect(capture.output.join('')).toBe(
      'Skipped bare/feature: uncommitted changes (upstream-gone)\n' +
        'Skipped 1 worktree(s) with uncommitted changes\n'
    );
  });

  test('skips main worktree', async () => {
    // Clone regular (non-bare) repo
    const repoDir = join(testDir, 'repo');
    await runGitCommand(['clone', sourceDir, repoDir]);

    // Create worktree that is merged
    const worktreePath = join(testDir, 'repo-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      repoDir
    );

    // Merge feature into main (it's already there, so it's "merged")
    // The feature branch points to the same commit as main

    // Create config
    const config = {
      repos: [{ name: 'repo', url: sourceDir, path: repoDir }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run cleanup
    const ctx = { configPath };
    await cleanupCommand(ctx, { dryRun: false, tmux: false });

    // Main worktree should still exist
    expect(await isGitRepo(repoDir)).toBe(true);
  });

  test('dry-run shows what would be removed without removing', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create worktree with tracking
    const worktreePath = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    // Push the branch
    await Bun.write(join(worktreePath, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath);
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath);

    // Delete remote branch
    await runGitCommand(['branch', '-D', 'feature'], sourceDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run cleanup with dry-run
    const capture = captureStdout();
    const ctx = { configPath };
    await cleanupCommand(ctx, { dryRun: true, tmux: false });
    capture.restore();

    // Verify worktree still exists
    expect(await isGitRepo(worktreePath)).toBe(true);

    // Verify output mentions what would be removed
    expect(capture.output.join('')).toBe(
      'Would remove bare/feature (upstream deleted)\n' +
        '\n' +
        'Would remove 1 worktree(s) (1 upstream deleted)\n'
    );
  });

  test('works across multiple repos', async () => {
    // Create second source repo
    const sourceDir2 = '/tmp/repos-test-cleanup-cmd-source2';
    await createTestRepo(sourceDir2);

    // Clone both as bare
    const bareDir1 = join(testDir, 'bare1.git');
    const bareDir2 = join(testDir, 'bare2.git');
    await cloneBare(sourceDir, bareDir1);
    await cloneBare(sourceDir2, bareDir2);

    // Create worktrees for both
    const worktreePath1 = join(testDir, 'bare1.git-feature');
    const worktreePath2 = join(testDir, 'bare2.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath1],
      bareDir1
    );
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath2],
      bareDir2
    );

    // Push both branches
    await Bun.write(join(worktreePath1, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath1);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath1);
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath1);

    await Bun.write(join(worktreePath2, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath2);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath2);
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath2);

    // Delete remote branches
    await runGitCommand(['branch', '-D', 'feature'], sourceDir);
    await runGitCommand(['branch', '-D', 'feature'], sourceDir2);

    // Create config
    const config = {
      repos: [
        { name: 'bare1', url: sourceDir, path: bareDir1, bare: true },
        { name: 'bare2', url: sourceDir2, path: bareDir2, bare: true },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Verify worktrees exist before
    expect(await isGitRepo(worktreePath1)).toBe(true);
    expect(await isGitRepo(worktreePath2)).toBe(true);

    // Run cleanup
    const ctx = { configPath };
    await cleanupCommand(ctx, { dryRun: false, tmux: false });

    // Verify both worktrees were removed
    expect(await isGitRepo(worktreePath1)).toBe(false);
    expect(await isGitRepo(worktreePath2)).toBe(false);

    // Cleanup second source
    await rm(sourceDir2, { recursive: true, force: true });
  });

  test('does not remove worktree for unpushed branch with commits', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create worktree WITHOUT pushing
    const worktreePath = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    // Make a commit but don't push
    await Bun.write(join(worktreePath, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run cleanup
    const ctx = { configPath };
    await cleanupCommand(ctx, { dryRun: false, tmux: false });

    // Verify worktree still exists (not pushed, should not be cleaned)
    expect(await isGitRepo(worktreePath)).toBe(true);
  });

  test('does not remove fresh worktree with no commits', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create worktree with no additional commits (just branched from main)
    const worktreePath = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    // No commits made - this is a fresh branch at same point as main
    // git cherry would return empty, which could be misinterpreted as "merged"

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run cleanup
    const ctx = { configPath };
    await cleanupCommand(ctx, { dryRun: false, tmux: false });

    // Verify worktree still exists (fresh branch, should not be cleaned)
    expect(await isGitRepo(worktreePath)).toBe(true);
  });

  test('does not remove worktree with active remote branch', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create worktree with tracking
    const worktreePath = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    // Push the branch (but don't delete it)
    await Bun.write(join(worktreePath, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath);
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath);

    // Remote branch still exists - should NOT be cleaned up

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run cleanup
    const ctx = { configPath };
    await cleanupCommand(ctx, { dryRun: false, tmux: false });

    // Verify worktree still exists (not cleaned up because remote exists and not merged)
    expect(await isGitRepo(worktreePath)).toBe(true);
  });

  test('removes worktree when branch was squash-merged', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create worktree
    const worktreePath = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    // Make a commit on feature
    await Bun.write(join(worktreePath, 'feature.txt'), 'feature content');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath);

    // Push to origin with tracking (required for cleanup to recognize as tracking)
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath);

    // Simulate squash merge: apply the same changes to main with a different commit
    await Bun.write(join(sourceDir, 'feature.txt'), 'feature content');
    await runGitCommand(['add', '.'], sourceDir);
    await runGitCommand(
      ['commit', '-m', 'Squash merge: feature work'],
      sourceDir
    );

    // Fetch to get the updated main
    await runGitCommand(['fetch', 'origin'], bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Verify worktree exists before
    expect(await isGitRepo(worktreePath)).toBe(true);

    // Run cleanup command
    const ctx = { configPath };
    await cleanupCommand(ctx, { dryRun: false, tmux: false });

    // Verify worktree was removed (squash merge detected via git cherry)
    expect(await isGitRepo(worktreePath)).toBe(false);
  });

  test('removes worktree when branch was rebase-merged', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create worktree
    const worktreePath = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    // Make commits on feature
    await Bun.write(join(worktreePath, 'feature1.txt'), 'feature 1');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature commit 1'], worktreePath);
    await Bun.write(join(worktreePath, 'feature2.txt'), 'feature 2');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature commit 2'], worktreePath);

    // Push feature to origin with tracking so sourceDir has the commits
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath);

    // Simulate rebase merge: cherry-pick the commits onto main in sourceDir
    // The feature branch now exists locally in sourceDir (from the push)
    // Get the commits from feature branch that aren't in main
    const logResult = await runGitCommand(
      ['log', '--format=%H', 'HEAD..feature'],
      sourceDir
    );
    const commits = logResult.stdout.split('\n').filter(Boolean).reverse();

    // Cherry-pick each commit onto main (creates new commit SHAs)
    for (const commit of commits) {
      await runGitCommand(['cherry-pick', commit], sourceDir);
    }

    // Fetch to get the updated main
    await runGitCommand(['fetch', 'origin'], bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Verify worktree exists before
    expect(await isGitRepo(worktreePath)).toBe(true);

    // Run cleanup command
    const ctx = { configPath };
    await cleanupCommand(ctx, { dryRun: false, tmux: false });

    // Verify worktree was removed (rebase merge detected via git cherry)
    expect(await isGitRepo(worktreePath)).toBe(false);
  });

  test('only cleans up current repo when run inside a tracked repo', async () => {
    // Create second source repo
    const sourceDir2 = '/tmp/repos-test-cleanup-cmd-source2';
    await createTestRepo(sourceDir2);

    // Clone both as bare
    const bareDir1 = join(testDir, 'bare1.git');
    const bareDir2 = join(testDir, 'bare2.git');
    await cloneBare(sourceDir, bareDir1);
    await cloneBare(sourceDir2, bareDir2);

    // Create worktrees for both
    const worktreePath1 = join(testDir, 'bare1.git-feature');
    const worktreePath2 = join(testDir, 'bare2.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath1],
      bareDir1
    );
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath2],
      bareDir2
    );

    // Push both branches
    await Bun.write(join(worktreePath1, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath1);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath1);
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath1);

    await Bun.write(join(worktreePath2, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath2);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath2);
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath2);

    // Delete remote branches on both
    await runGitCommand(['branch', '-D', 'feature'], sourceDir);
    await runGitCommand(['branch', '-D', 'feature'], sourceDir2);

    // Create config
    const config = {
      repos: [
        { name: 'bare1', url: sourceDir, path: bareDir1, bare: true },
        { name: 'bare2', url: sourceDir2, path: bareDir2, bare: true },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Verify worktrees exist before
    expect(await isGitRepo(worktreePath1)).toBe(true);
    expect(await isGitRepo(worktreePath2)).toBe(true);

    // Change to bare1's worktree to simulate being inside it
    process.chdir(worktreePath1);

    // Run cleanup
    const ctx = { configPath };
    await cleanupCommand(ctx, { dryRun: false, tmux: false });

    // Verify only bare1's worktree was removed
    expect(await isGitRepo(worktreePath1)).toBe(false);
    // bare2's worktree should still exist
    expect(await isGitRepo(worktreePath2)).toBe(true);

    // Cleanup second source
    await rm(sourceDir2, { recursive: true, force: true });
  });

  test('repos list shows only active worktree after cleanup removes stale and merged', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create 3 worktrees: a, b, c
    const wtAPath = join(testDir, 'bare.git-branch-a');
    const wtBPath = join(testDir, 'bare.git-branch-b');
    const wtCPath = join(testDir, 'bare.git-branch-c');
    await runGitCommand(
      ['worktree', 'add', '-b', 'branch-a', wtAPath],
      bareDir
    );
    await runGitCommand(
      ['worktree', 'add', '-b', 'branch-b', wtBPath],
      bareDir
    );
    await runGitCommand(
      ['worktree', 'add', '-b', 'branch-c', wtCPath],
      bareDir
    );

    // Push all 3 with upstream tracking
    await Bun.write(join(wtAPath, 'a.txt'), 'a');
    await runGitCommand(['add', '.'], wtAPath);
    await runGitCommand(['commit', '-m', 'branch a work'], wtAPath);
    await runGitCommand(['push', '-u', 'origin', 'branch-a'], wtAPath);

    await Bun.write(join(wtBPath, 'b.txt'), 'b');
    await runGitCommand(['add', '.'], wtBPath);
    await runGitCommand(['commit', '-m', 'branch b work'], wtBPath);
    await runGitCommand(['push', '-u', 'origin', 'branch-b'], wtBPath);

    await Bun.write(join(wtCPath, 'c.txt'), 'c');
    await runGitCommand(['add', '.'], wtCPath);
    await runGitCommand(['commit', '-m', 'branch c work'], wtCPath);
    await runGitCommand(['push', '-u', 'origin', 'branch-c'], wtCPath);

    // Capture real paths before any deletion (git worktree list resolves symlinks)
    const wtARealPath = await realpath(wtAPath);
    const wtBRealPath = await realpath(wtBPath);
    const wtCRealPath = await realpath(wtCPath);

    // Delete worktree-a directory manually (stale reference remains in git)
    await rm(wtAPath, { recursive: true, force: true });

    // Merge branch-c into main on sourceDir (simulating PR merge), then fetch
    await runGitCommand(
      ['merge', 'branch-c', '-m', 'merge branch-c'],
      sourceDir
    );
    await runGitCommand(['fetch', 'origin'], bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run repos list from outside any repo - all 3 should be listed
    process.chdir('/tmp');
    const captureBefore = captureStdout();
    await listCommand({ configPath });
    captureBefore.restore();

    expect(captureBefore.output.join('')).toEqual(
      [
        'Tracked repositories:',
        '',
        '  bare (bare) ✓',
        `    ${bareDir}`,
        `      ├─ branch-a: ${wtARealPath}`,
        `      ├─ branch-b: ${wtBRealPath}`,
        `      └─ branch-c: ${wtCRealPath}`,
        '',
      ].join('\n')
    );

    // Run repos cleanup
    const ctx = { configPath };
    await cleanupCommand(ctx, { dryRun: false, tmux: false });

    // Run repos list again - only branch-b should remain
    process.chdir('/tmp');
    const captureAfter = captureStdout();
    await listCommand({ configPath });
    captureAfter.restore();

    expect(captureAfter.output.join('')).toEqual(
      [
        'Tracked repositories:',
        '',
        '  bare (bare) ✓',
        `    ${bareDir}`,
        `      └─ branch-b: ${wtBRealPath}`,
        '',
      ].join('\n')
    );
  });

  test('cleans up all repos when run outside any tracked repo', async () => {
    // Create second source repo
    const sourceDir2 = '/tmp/repos-test-cleanup-cmd-source2';
    await createTestRepo(sourceDir2);

    // Clone both as bare
    const bareDir1 = join(testDir, 'bare1.git');
    const bareDir2 = join(testDir, 'bare2.git');
    await cloneBare(sourceDir, bareDir1);
    await cloneBare(sourceDir2, bareDir2);

    // Create worktrees for both
    const worktreePath1 = join(testDir, 'bare1.git-feature');
    const worktreePath2 = join(testDir, 'bare2.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath1],
      bareDir1
    );
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath2],
      bareDir2
    );

    // Push both branches
    await Bun.write(join(worktreePath1, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath1);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath1);
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath1);

    await Bun.write(join(worktreePath2, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath2);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath2);
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath2);

    // Delete remote branches on both
    await runGitCommand(['branch', '-D', 'feature'], sourceDir);
    await runGitCommand(['branch', '-D', 'feature'], sourceDir2);

    // Create config
    const config = {
      repos: [
        { name: 'bare1', url: sourceDir, path: bareDir1, bare: true },
        { name: 'bare2', url: sourceDir2, path: bareDir2, bare: true },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Verify worktrees exist before
    expect(await isGitRepo(worktreePath1)).toBe(true);
    expect(await isGitRepo(worktreePath2)).toBe(true);

    // Change to /tmp to simulate being outside any tracked repo
    process.chdir('/tmp');

    // Run cleanup
    const ctx = { configPath };
    await cleanupCommand(ctx, { dryRun: false, tmux: false });

    // Verify both worktrees were removed
    expect(await isGitRepo(worktreePath1)).toBe(false);
    expect(await isGitRepo(worktreePath2)).toBe(false);

    // Cleanup second source
    await rm(sourceDir2, { recursive: true, force: true });
  });
});
