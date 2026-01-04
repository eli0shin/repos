import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  runGitCommand,
  cloneBare,
  listWorktrees,
  isGitRepo,
  getCurrentBranch,
  hasUncommittedChanges,
} from '../src/git.ts';
import { workCommand } from '../src/commands/work.ts';
import { cleanCommand } from '../src/commands/clean.ts';
import { rebaseCommand } from '../src/commands/rebase.ts';
import { writeConfig } from '../src/config.ts';
import type { ReposConfig } from '../src/types.ts';
import { mockProcessExit, type MockExit } from './utils.ts';
import { anyString } from './helpers.ts';

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

describe('repos work command', () => {
  const testDir = '/tmp/repos-test-work-cmd';
  const sourceDir = '/tmp/repos-test-work-cmd-source';
  const configPath = '/tmp/repos-test-work-cmd-config/config.json';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-work-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('creates worktree for a bare repo', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run work command
    const ctx = { configPath };
    await workCommand(ctx, 'feature', 'bare');

    // Verify worktree was created
    const worktreePath = join(testDir, 'bare.git-feature');
    expect(await isGitRepo(worktreePath)).toBe(true);
    expect(await getCurrentBranch(worktreePath)).toEqual({
      success: true,
      data: 'feature',
    });
  });

  test('creates worktree for branch with slash in name', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run work command with slashed branch name
    const ctx = { configPath };
    await workCommand(ctx, 'feature/add-worktrees', 'bare');

    // Verify worktree was created with sanitized path (- not /)
    const worktreePath = join(testDir, 'bare.git-feature-add-worktrees');
    expect(await isGitRepo(worktreePath)).toBe(true);
    expect(await getCurrentBranch(worktreePath)).toEqual({
      success: true,
      data: 'feature/add-worktrees',
    });
  });

  test('creates worktree for a regular repo', async () => {
    // Clone regular
    const repoDir = join(testDir, 'repo');
    await runGitCommand(['clone', sourceDir, repoDir]);

    // Create config
    const config = {
      repos: [{ name: 'repo', url: sourceDir, path: repoDir }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run work command
    const ctx = { configPath };
    await workCommand(ctx, 'feature', 'repo');

    // Verify worktree was created
    const worktreePath = join(testDir, 'repo-feature');
    expect(await isGitRepo(worktreePath)).toBe(true);
    expect(await getCurrentBranch(worktreePath)).toEqual({
      success: true,
      data: 'feature',
    });
  });

  test('outputs existing worktree path when it already exists', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Create worktree manually
    const worktreePath = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    // Capture stdout
    const output: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      output.push(chunk);
      return true;
    };

    const ctx = { configPath };
    await workCommand(ctx, 'feature', 'bare');
    process.stdout.write = originalWrite;

    // Should output the existing worktree path
    expect(output.join('')).toEqual(realpathSync(worktreePath) + '\n');
  });
});

describe('repos clean command', () => {
  const testDir = '/tmp/repos-test-clean-cmd';
  const sourceDir = '/tmp/repos-test-clean-cmd-source';
  const configPath = '/tmp/repos-test-clean-cmd-config/config.json';
  let mockExit: MockExit;

  beforeEach(async () => {
    mockExit = mockProcessExit();
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
    mockExit.mockRestore();
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-clean-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('removes a worktree', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create worktree
    const worktreePath = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Verify worktree exists before
    expect(await isGitRepo(worktreePath)).toBe(true);

    // Run clean command
    const ctx = { configPath };
    await cleanCommand(ctx, 'feature', 'bare');

    // Verify worktree was removed
    expect(await isGitRepo(worktreePath)).toBe(false);
  });

  test('fails when worktree has uncommitted changes', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create worktree
    const worktreePath = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    // Add uncommitted changes
    await Bun.write(join(worktreePath, 'dirty.txt'), 'dirty');

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Verify there are uncommitted changes
    expect(await hasUncommittedChanges(worktreePath)).toEqual({
      success: true,
      data: true,
    });

    // Run clean command - should fail
    const ctx = { configPath };
    await expect(cleanCommand(ctx, 'feature', 'bare')).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);

    // Verify worktree still exists
    expect(await isGitRepo(worktreePath)).toBe(true);
  });

  test('fails when worktree does not exist', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run clean command - should fail
    const ctx = { configPath };
    await expect(cleanCommand(ctx, 'nonexistent', 'bare')).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe('repos rebase command', () => {
  const testDir = '/tmp/repos-test-rebase-cmd';
  const remoteDir = '/tmp/repos-test-rebase-cmd-remote';
  const configPath = '/tmp/repos-test-rebase-cmd-config/config.json';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    // Create a bare remote repo
    await mkdir(remoteDir, { recursive: true });
    await runGitCommand(['init', '--bare'], remoteDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-rebase-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('rebases worktree on default branch', async () => {
    // Clone the remote
    const localDir = join(testDir, 'local');
    await runGitCommand(['clone', remoteDir, localDir]);
    await runGitCommand(['config', 'user.email', 'test@test.com'], localDir);
    await runGitCommand(['config', 'user.name', 'Test'], localDir);

    // Create initial commit on main and push
    await Bun.write(join(localDir, 'main.txt'), 'main');
    await runGitCommand(['add', '.'], localDir);
    await runGitCommand(['commit', '-m', 'main commit'], localDir);
    await runGitCommand(['push', '-u', 'origin', 'HEAD'], localDir);

    // Create feature branch worktree
    const worktreePath = join(testDir, 'local-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      localDir
    );
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      worktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], worktreePath);

    // Add commit to feature branch
    await Bun.write(join(worktreePath, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature commit'], worktreePath);

    // Create config
    const config = {
      repos: [{ name: 'local', url: remoteDir, path: localDir }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run rebase command
    const ctx = { configPath };
    await rebaseCommand(ctx, 'feature', 'local');

    // Verify the worktree still exists and is on feature branch
    expect(await isGitRepo(worktreePath)).toBe(true);
    expect(await getCurrentBranch(worktreePath)).toEqual({
      success: true,
      data: 'feature',
    });
  });
});

describe('worktree workflow integration', () => {
  const testDir = '/tmp/repos-test-workflow';
  const sourceDir = '/tmp/repos-test-workflow-source';
  const configPath = '/tmp/repos-test-workflow-config/config.json';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-workflow-config', {
      recursive: true,
      force: true,
    });
  });

  test('full workflow: work -> commit -> clean', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Step 1: Create worktree
    await workCommand(ctx, 'feature', 'bare');
    const worktreePath = join(testDir, 'bare.git-feature');
    expect(await isGitRepo(worktreePath)).toBe(true);

    // Step 2: Make changes and commit
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      worktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], worktreePath);
    await Bun.write(join(worktreePath, 'feature.txt'), 'feature work');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath);

    // Verify clean working tree
    expect(await hasUncommittedChanges(worktreePath)).toEqual({
      success: true,
      data: false,
    });

    // Step 3: Clean up worktree
    await cleanCommand(ctx, 'feature', 'bare');
    expect(await isGitRepo(worktreePath)).toBe(false);

    // Verify worktree is removed from list (only main worktree remains)
    expect(await listWorktrees(bareDir)).toEqual({
      success: true,
      data: [
        {
          path: anyString(),
          branch: anyString(),
          isMain: true,
        },
      ],
    });
  });
});
