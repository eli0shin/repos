import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runGitCommand, cloneBare } from '../src/git/index.ts';
import { workCommand } from '../src/commands/work.ts';
import { stackCommand } from '../src/commands/stack.ts';
import { squashCommand } from '../src/commands/squash.ts';
import { writeConfig } from '../src/config.ts';
import type { ReposConfig } from '../src/types.ts';
import { mockProcessExit, type MockExit } from './utils.ts';

async function createTestRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await runGitCommand(['init', '-b', 'main'], dir);
  await Bun.write(join(dir, 'test.txt'), 'test');
  await runGitCommand(['add', '.'], dir);
  await runGitCommand(['commit', '-m', 'initial'], dir);
}

async function addCommit(
  dir: string,
  filename: string,
  message: string
): Promise<void> {
  await Bun.write(join(dir, filename), `content for ${filename}`);
  await runGitCommand(['add', '.'], dir);
  await runGitCommand(['commit', '-m', message], dir);
}

async function getCommitMessages(dir: string): Promise<string[]> {
  const result = await runGitCommand(['log', '--format=%s'], dir);
  return result.stdout.split('\n').filter(Boolean);
}

async function getCommitCount(dir: string, base: string): Promise<number> {
  const result = await runGitCommand(
    ['rev-list', '--count', `${base}..HEAD`],
    dir
  );
  return parseInt(result.stdout, 10);
}

describe('repos squash command', () => {
  const testDir = '/tmp/repos-test-squash-cmd';
  const sourceDir = '/tmp/repos-test-squash-cmd-source';
  const configPath = '/tmp/repos-test-squash-cmd-config/config.json';
  let mockExit: MockExit;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    mockExit = mockProcessExit();
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    mockExit.mockRestore();
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-squash-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('squashes multiple commits with -m flag', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create worktree
    await workCommand(ctx, 'feature', 'bare');
    const worktreePath = join(testDir, 'bare.git-feature');

    // Add 3 commits
    await addCommit(worktreePath, 'file1.txt', 'first commit');
    await addCommit(worktreePath, 'file2.txt', 'second commit');
    await addCommit(worktreePath, 'file3.txt', 'third commit');

    // Get the base (origin/main)
    const countBefore = await getCommitCount(worktreePath, 'origin/main');
    expect(countBefore).toBe(3);

    // Squash with -m flag
    process.chdir(worktreePath);
    await squashCommand(ctx, { message: 'squashed commit' });

    // Verify only 1 commit since base
    const countAfter = await getCommitCount(worktreePath, 'origin/main');
    expect(countAfter).toBe(1);

    // Verify commit message
    const messages = await getCommitMessages(worktreePath);
    expect(messages[0]).toBe('squashed commit');
  });

  test('squashes commits with -f (first commit message)', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create worktree
    await workCommand(ctx, 'feature', 'bare');
    const worktreePath = join(testDir, 'bare.git-feature');

    // Add 3 commits
    await addCommit(worktreePath, 'file1.txt', 'First: add user login');
    await addCommit(worktreePath, 'file2.txt', 'Second: add logout');
    await addCommit(worktreePath, 'file3.txt', 'Third: add tests');

    // Squash with --first flag
    process.chdir(worktreePath);
    await squashCommand(ctx, { first: true });

    // Verify commit message is from first commit
    const messages = await getCommitMessages(worktreePath);
    expect(messages[0]).toBe('First: add user login');

    // Verify only 1 commit since base
    const countAfter = await getCommitCount(worktreePath, 'origin/main');
    expect(countAfter).toBe(1);
  });

  test('stacked branch uses parent branch as base', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Step 1: Create parent worktree
    await workCommand(ctx, 'parent-branch', 'bare');
    const parentWorktreePath = join(testDir, 'bare.git-parent-branch');

    // Add commit to parent
    await addCommit(parentWorktreePath, 'parent.txt', 'parent commit');

    // Step 2: Stack child from parent
    process.chdir(parentWorktreePath);
    await stackCommand(ctx, 'child-branch');

    // Step 3: Add commits to child
    const childWorktreePath = join(testDir, 'bare.git-child-branch');

    await addCommit(childWorktreePath, 'child1.txt', 'child commit 1');
    await addCommit(childWorktreePath, 'child2.txt', 'child commit 2');
    await addCommit(childWorktreePath, 'child3.txt', 'child commit 3');

    // Verify 3 commits since parent
    const countBefore = await getCommitCount(
      childWorktreePath,
      'parent-branch'
    );
    expect(countBefore).toBe(3);

    // Step 4: Squash in child worktree
    process.chdir(childWorktreePath);
    await squashCommand(ctx, { message: 'squashed child commits' });

    // Verify 1 commit since parent (not origin/main)
    const countAfter = await getCommitCount(childWorktreePath, 'parent-branch');
    expect(countAfter).toBe(1);

    // Verify commit message
    const messages = await getCommitMessages(childWorktreePath);
    expect(messages[0]).toBe('squashed child commits');
  });

  test('fails when working directory has uncommitted changes', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create worktree
    await workCommand(ctx, 'feature', 'bare');
    const worktreePath = join(testDir, 'bare.git-feature');

    // Add a commit then make uncommitted changes
    await addCommit(worktreePath, 'file1.txt', 'first commit');
    await Bun.write(join(worktreePath, 'uncommitted.txt'), 'dirty');

    // Attempt squash
    process.chdir(worktreePath);
    await expect(squashCommand(ctx, { message: 'squashed' })).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('fails when no commits to squash', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create worktree (no extra commits)
    await workCommand(ctx, 'feature', 'bare');
    const worktreePath = join(testDir, 'bare.git-feature');

    // Attempt squash with no commits
    process.chdir(worktreePath);
    await expect(squashCommand(ctx, { message: 'squashed' })).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('handles single commit gracefully', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create worktree
    await workCommand(ctx, 'feature', 'bare');
    const worktreePath = join(testDir, 'bare.git-feature');

    // Add only 1 commit
    await addCommit(worktreePath, 'file1.txt', 'only commit');

    // Capture stdout
    const output: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      output.push(chunk);
      return true;
    };

    // Squash (should gracefully skip)
    process.chdir(worktreePath);
    await squashCommand(ctx, { message: 'squashed' });
    process.stdout.write = originalWrite;

    // Should mention nothing to squash
    expect(output.join('')).toContain('1 commit');

    // Verify commit is unchanged
    const messages = await getCommitMessages(worktreePath);
    expect(messages[0]).toBe('only commit');
  });

  test('works in regular branch (not worktree)', async () => {
    // Clone regular repo
    const repoDir = join(testDir, 'repo');
    await runGitCommand(['clone', sourceDir, repoDir]);

    // Create config
    const config = {
      repos: [{ name: 'repo', url: sourceDir, path: repoDir }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create branch and checkout
    await runGitCommand(['checkout', '-b', 'feature'], repoDir);

    // Add 2 commits
    await addCommit(repoDir, 'file1.txt', 'first commit');
    await addCommit(repoDir, 'file2.txt', 'second commit');

    // Squash
    process.chdir(repoDir);
    await squashCommand(ctx, { message: 'squashed in regular repo' });

    // Verify only 1 commit since origin/main
    const countAfter = await getCommitCount(repoDir, 'origin/main');
    expect(countAfter).toBe(1);

    // Verify commit message
    const messages = await getCommitMessages(repoDir);
    expect(messages[0]).toBe('squashed in regular repo');
  });

  test('fails when not inside a tracked repo', async () => {
    // Create empty config
    const config = { repos: [] } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Try to squash from outside tracked repos
    process.chdir(testDir);
    await expect(squashCommand(ctx, { message: 'squashed' })).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('squashes with multi-line commit message using -f flag', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create worktree
    await workCommand(ctx, 'feature', 'bare');
    const worktreePath = join(testDir, 'bare.git-feature');

    // Add first commit with multi-line message
    await Bun.write(join(worktreePath, 'file1.txt'), 'content');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(
      ['commit', '-m', 'First line\n\nSecond paragraph\n\nThird paragraph'],
      worktreePath
    );

    // Add more commits
    await addCommit(worktreePath, 'file2.txt', 'second commit');
    await addCommit(worktreePath, 'file3.txt', 'third commit');

    // Squash with --first flag
    process.chdir(worktreePath);
    await squashCommand(ctx, { first: true });

    // Verify full multi-line message is preserved
    const result = await runGitCommand(
      ['log', '-1', '--format=%B'],
      worktreePath
    );
    const fullMessage = result.stdout.trim();
    expect(fullMessage).toBe(
      'First line\n\nSecond paragraph\n\nThird paragraph'
    );

    // Verify only 1 commit since base
    const countAfter = await getCommitCount(worktreePath, 'origin/main');
    expect(countAfter).toBe(1);
  });

  test('fails when both -m and -f flags are provided', async () => {
    // Create empty config (we don't need a repo for this test)
    const config = { repos: [] } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Try to squash with both flags
    process.chdir(testDir);
    await expect(
      squashCommand(ctx, { message: 'custom', first: true })
    ).rejects.toThrow('process.exit(1)');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('fails when commit message is empty', async () => {
    // Create empty config (we don't need a repo for this test)
    const config = { repos: [] } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Try to squash with empty message
    process.chdir(testDir);
    await expect(squashCommand(ctx, { message: '' })).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('fails when commit message is whitespace only', async () => {
    // Create empty config (we don't need a repo for this test)
    const config = { repos: [] } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Try to squash with whitespace-only message
    process.chdir(testDir);
    await expect(squashCommand(ctx, { message: '   ' })).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('--dry-run shows commits without squashing', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create worktree
    await workCommand(ctx, 'feature', 'bare');
    const worktreePath = join(testDir, 'bare.git-feature');

    // Add 3 commits
    await addCommit(worktreePath, 'file1.txt', 'first commit');
    await addCommit(worktreePath, 'file2.txt', 'second commit');
    await addCommit(worktreePath, 'file3.txt', 'third commit');

    // Capture stdout
    const output: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      output.push(chunk);
      return true;
    };

    // Run dry-run
    process.chdir(worktreePath);
    await squashCommand(ctx, { dryRun: true });
    process.stdout.write = originalWrite;

    const outputStr = output.join('');

    // Verify output contains expected sections
    expect(outputStr).toContain('Dry run: 3 commit(s) would be squashed');
    expect(outputStr).toContain('Commits to be squashed:');
    expect(outputStr).toContain('first commit');
    expect(outputStr).toContain('second commit');
    expect(outputStr).toContain('third commit');
    expect(outputStr).toContain('Merge base');
    expect(outputStr).toContain('Branches containing merge-base:');

    // Verify commits are NOT squashed
    const countAfter = await getCommitCount(worktreePath, 'origin/main');
    expect(countAfter).toBe(3);
  });

  test('--dry-run with single commit shows nothing to squash', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create worktree
    await workCommand(ctx, 'feature', 'bare');
    const worktreePath = join(testDir, 'bare.git-feature');

    // Add only 1 commit
    await addCommit(worktreePath, 'file1.txt', 'only commit');

    // Capture stdout
    const output: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      output.push(chunk);
      return true;
    };

    // Run dry-run
    process.chdir(worktreePath);
    await squashCommand(ctx, { dryRun: true });
    process.stdout.write = originalWrite;

    // Should exit early with "nothing to squash" message
    expect(output.join('')).toContain('1 commit');

    // Verify commit is unchanged
    const countAfter = await getCommitCount(worktreePath, 'origin/main');
    expect(countAfter).toBe(1);
  });

  test('--dry-run on stacked branch shows parent as base', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create parent worktree with commit
    await workCommand(ctx, 'parent-branch', 'bare');
    const parentWorktreePath = join(testDir, 'bare.git-parent-branch');
    await addCommit(parentWorktreePath, 'parent.txt', 'parent commit');

    // Stack child from parent
    process.chdir(parentWorktreePath);
    await stackCommand(ctx, 'child-branch');

    // Add commits to child
    const childWorktreePath = join(testDir, 'bare.git-child-branch');
    await addCommit(childWorktreePath, 'child1.txt', 'child commit 1');
    await addCommit(childWorktreePath, 'child2.txt', 'child commit 2');

    // Capture stdout
    const output: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      output.push(chunk);
      return true;
    };

    // Run dry-run
    process.chdir(childWorktreePath);
    await squashCommand(ctx, { dryRun: true });
    process.stdout.write = originalWrite;

    const outputStr = output.join('');

    // Verify output shows parent branch as base
    expect(outputStr).toContain('Dry run: 2 commit(s) would be squashed');
    expect(outputStr).toContain('child commit 1');
    expect(outputStr).toContain('child commit 2');
    expect(outputStr).toContain('Base ref: parent-branch');

    // Verify commits are NOT squashed
    const countAfter = await getCommitCount(childWorktreePath, 'parent-branch');
    expect(countAfter).toBe(2);
  });

  test('--dry-run with no commits shows error', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create worktree (no extra commits)
    await workCommand(ctx, 'feature', 'bare');
    const worktreePath = join(testDir, 'bare.git-feature');

    // Attempt dry-run with no commits
    process.chdir(worktreePath);
    await expect(squashCommand(ctx, { dryRun: true })).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('--dry-run works without -m or -f flags', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create worktree
    await workCommand(ctx, 'feature', 'bare');
    const worktreePath = join(testDir, 'bare.git-feature');

    // Add 2 commits
    await addCommit(worktreePath, 'file1.txt', 'first commit');
    await addCommit(worktreePath, 'file2.txt', 'second commit');

    // Should work without -m or -f
    process.chdir(worktreePath);
    await squashCommand(ctx, { dryRun: true });

    // Verify commits unchanged
    const countAfter = await getCommitCount(worktreePath, 'origin/main');
    expect(countAfter).toBe(2);
  });

  test('--dry-run fails with uncommitted changes', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create worktree
    await workCommand(ctx, 'feature', 'bare');
    const worktreePath = join(testDir, 'bare.git-feature');

    // Add commit then make uncommitted changes
    await addCommit(worktreePath, 'file1.txt', 'first commit');
    await Bun.write(join(worktreePath, 'dirty.txt'), 'uncommitted');

    process.chdir(worktreePath);
    await expect(squashCommand(ctx, { dryRun: true })).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
