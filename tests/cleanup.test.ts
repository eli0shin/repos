import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runGitCommand, cloneBare, isGitRepo } from '../src/git.ts';
import { cleanupCommand } from '../src/commands/cleanup.ts';
import { writeConfig } from '../src/config.ts';
import type { ReposConfig } from '../src/types.ts';

// Helper to create a test repo with commits
async function createTestRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await runGitCommand(['init'], dir);
  await runGitCommand(['config', 'user.email', 'test@test.com'], dir);
  await runGitCommand(['config', 'user.name', 'Test'], dir);
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

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
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
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      worktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], worktreePath);
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
    await cleanupCommand(ctx, { dryRun: false });

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
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      worktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], worktreePath);
    await Bun.write(join(worktreePath, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath);

    // Merge feature into main on the source (simulating PR merge)
    // First fetch the feature branch from the worktree into sourceDir
    await runGitCommand(['fetch', worktreePath, 'feature'], sourceDir);
    await runGitCommand(
      ['merge', 'FETCH_HEAD', '-m', 'merge feature'],
      sourceDir
    );

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
    await cleanupCommand(ctx, { dryRun: false });

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
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      worktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], worktreePath);
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
    await cleanupCommand(ctx, { dryRun: false });
    capture.restore();

    // Verify worktree still exists (not removed due to uncommitted changes)
    expect(await isGitRepo(worktreePath)).toBe(true);

    // Verify warning was output
    expect(capture.output.join('')).toContain('uncommitted changes');
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
    await cleanupCommand(ctx, { dryRun: false });

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
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      worktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], worktreePath);
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
    await cleanupCommand(ctx, { dryRun: true });
    capture.restore();

    // Verify worktree still exists
    expect(await isGitRepo(worktreePath)).toBe(true);

    // Verify output mentions what would be removed
    expect(capture.output.join('')).toContain('feature');
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
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      worktreePath1
    );
    await runGitCommand(['config', 'user.name', 'Test'], worktreePath1);
    await Bun.write(join(worktreePath1, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath1);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath1);
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath1);

    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      worktreePath2
    );
    await runGitCommand(['config', 'user.name', 'Test'], worktreePath2);
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
    await cleanupCommand(ctx, { dryRun: false });

    // Verify both worktrees were removed
    expect(await isGitRepo(worktreePath1)).toBe(false);
    expect(await isGitRepo(worktreePath2)).toBe(false);

    // Cleanup second source
    await rm(sourceDir2, { recursive: true, force: true });
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
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      worktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], worktreePath);
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
    await cleanupCommand(ctx, { dryRun: false });

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
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      worktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], worktreePath);
    await Bun.write(join(worktreePath, 'feature.txt'), 'feature content');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath);

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
    await cleanupCommand(ctx, { dryRun: false });

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
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      worktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], worktreePath);
    await Bun.write(join(worktreePath, 'feature1.txt'), 'feature 1');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature commit 1'], worktreePath);
    await Bun.write(join(worktreePath, 'feature2.txt'), 'feature 2');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature commit 2'], worktreePath);

    // Push feature to origin so sourceDir has the commits
    await runGitCommand(['push', 'origin', 'feature'], worktreePath);

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
    await cleanupCommand(ctx, { dryRun: false });

    // Verify worktree was removed (rebase merge detected via git cherry)
    expect(await isGitRepo(worktreePath)).toBe(false);
  });
});
