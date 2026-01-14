import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { realpathSync, existsSync } from 'node:fs';
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
import { stackCommand } from '../src/commands/stack.ts';
import { restackCommand } from '../src/commands/restack.ts';
import { continueCommand } from '../src/commands/continue.ts';
import { unstackCommand } from '../src/commands/unstack.ts';
import { cleanCommand } from '../src/commands/clean.ts';
import { rebaseCommand } from '../src/commands/rebase.ts';
import { writeConfig, readConfig } from '../src/config.ts';
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

  test('fails when branch has stacked children without --force', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create parent worktree
    const parentPath = join(testDir, 'bare.git-parent');
    await runGitCommand(
      ['worktree', 'add', '-b', 'parent', parentPath],
      bareDir
    );

    // Create child worktree
    const childPath = join(testDir, 'bare.git-child');
    await runGitCommand(['worktree', 'add', '-b', 'child', childPath], bareDir);

    // Create config with stack relationship
    const config = {
      repos: [
        {
          name: 'bare',
          url: sourceDir,
          path: bareDir,
          bare: true,
          stacks: [{ parent: 'parent', child: 'child' }],
        },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Verify worktrees exist
    expect(await isGitRepo(parentPath)).toBe(true);
    expect(await isGitRepo(childPath)).toBe(true);

    // Try to clean parent without --force - should fail
    const ctx = { configPath };
    await expect(cleanCommand(ctx, 'parent', 'bare')).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);

    // Verify parent worktree still exists
    expect(await isGitRepo(parentPath)).toBe(true);

    // Verify stack entry still exists
    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'bare',
            url: sourceDir,
            path: bareDir,
            bare: true,
            stacks: [{ parent: 'parent', child: 'child' }],
          },
        ],
      },
    });
  });

  test('removes parent worktree with --force and cleans up stack entries', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create parent worktree
    const parentPath = join(testDir, 'bare.git-parent');
    await runGitCommand(
      ['worktree', 'add', '-b', 'parent', parentPath],
      bareDir
    );

    // Create child worktree
    const childPath = join(testDir, 'bare.git-child');
    await runGitCommand(['worktree', 'add', '-b', 'child', childPath], bareDir);

    // Create config with stack relationship
    const config = {
      repos: [
        {
          name: 'bare',
          url: sourceDir,
          path: bareDir,
          bare: true,
          stacks: [{ parent: 'parent', child: 'child' }],
        },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Verify worktrees exist
    expect(await isGitRepo(parentPath)).toBe(true);
    expect(await isGitRepo(childPath)).toBe(true);

    // Clean parent with --force - should succeed
    const ctx = { configPath };
    await cleanCommand(ctx, 'parent', 'bare', { force: true, dryRun: false });

    // Verify parent worktree was removed
    expect(await isGitRepo(parentPath)).toBe(false);

    // Verify child worktree still exists (not deleted, just unstacked)
    expect(await isGitRepo(childPath)).toBe(true);

    // Verify stack entry was removed (child is now independent)
    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'bare',
            url: sourceDir,
            path: bareDir,
            bare: true,
          },
        ],
      },
    });
  });

  test('removes current worktree when no branch specified', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create worktree
    const worktreePathRaw = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePathRaw],
      bareDir
    );
    const worktreePath = realpathSync(worktreePathRaw);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Verify worktree exists before
    expect(await isGitRepo(worktreePath)).toBe(true);

    // Change to worktree directory and run clean without specifying branch
    process.chdir(worktreePath);
    const ctx = { configPath };
    await cleanCommand(ctx, undefined, undefined);

    // Verify worktree was removed
    expect(await isGitRepo(worktreePath)).toBe(false);
  });

  test('fails when not in worktree and no branch specified', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Change to a non-worktree directory (the bare repo dir)
    process.chdir(bareDir);
    const ctx = { configPath };
    await expect(cleanCommand(ctx, undefined, undefined)).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('dry-run shows what would be removed without removing', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create worktree
    const worktreePath = join(testDir, 'bare.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    // Create config with stack entry to verify it's not removed
    const config = {
      repos: [
        {
          name: 'bare',
          url: sourceDir,
          path: bareDir,
          bare: true,
          stacks: [{ parent: 'feature', child: 'child' }],
        },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Capture stdout
    const output: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      output.push(chunk);
      return true;
    };

    // Run clean with dry-run
    const ctx = { configPath };
    await cleanCommand(ctx, 'feature', 'bare', { force: true, dryRun: true });
    process.stdout.write = originalWrite;

    // Verify worktree still exists
    expect(await isGitRepo(worktreePath)).toBe(true);

    // Verify stack entry still exists (config not modified)
    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'bare',
            url: sourceDir,
            path: bareDir,
            bare: true,
            stacks: [{ parent: 'feature', child: 'child' }],
          },
        ],
      },
    });

    // Verify output shows "Would remove"
    expect(output.join('')).toBe('Would remove worktree "bare-feature"\n');
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

describe('repos stack command', () => {
  const testDir = '/tmp/repos-test-stack-cmd';
  const sourceDir = '/tmp/repos-test-stack-cmd-source';
  const configPath = '/tmp/repos-test-stack-cmd-config/config.json';
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-stack-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('creates stacked worktree from parent branch', async () => {
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
    expect(await isGitRepo(parentWorktreePath)).toBe(true);

    // Step 2: Make a commit on parent branch
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      parentWorktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], parentWorktreePath);
    await Bun.write(join(parentWorktreePath, 'parent.txt'), 'parent content');
    await runGitCommand(['add', '.'], parentWorktreePath);
    await runGitCommand(['commit', '-m', 'parent commit'], parentWorktreePath);

    // Step 3: Stack a child branch from within parent worktree
    const childWorktreePath = join(testDir, 'bare.git-child-branch');
    process.chdir(parentWorktreePath);
    await stackCommand(ctx, 'child-branch');

    // Verify child worktree was created
    expect(await isGitRepo(childWorktreePath)).toBe(true);
    expect(await getCurrentBranch(childWorktreePath)).toEqual({
      success: true,
      data: 'child-branch',
    });

    // Verify child has parent's commit
    const logResult = await runGitCommand(
      ['log', '--oneline', '-1'],
      childWorktreePath
    );
    expect(logResult.stdout).toContain('parent commit');

    // Verify stack relationship is recorded in config
    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'bare',
            url: sourceDir,
            path: bareDir,
            bare: true,
            stacks: [{ parent: 'parent-branch', child: 'child-branch' }],
          },
        ],
      },
    });
  });

  test('fails when not inside a worktree', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };
    const mockExit = mockProcessExit();

    // Try to stack from outside a worktree (bare dir)
    process.chdir(bareDir);
    await expect(stackCommand(ctx, 'child-branch')).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  test('fails when target branch already exists', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create parent worktree
    await workCommand(ctx, 'parent-branch', 'bare');
    const parentWorktreePath = join(testDir, 'bare.git-parent-branch');

    // Create another worktree for existing-branch
    await workCommand(ctx, 'existing-branch', 'bare');

    const mockExit = mockProcessExit();

    // Try to stack with existing branch name
    process.chdir(parentWorktreePath);
    await expect(stackCommand(ctx, 'existing-branch')).rejects.toThrow(
      'process.exit(1)'
    );
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });
});

describe('repos restack command', () => {
  const testDir = '/tmp/repos-test-restack-cmd';
  const sourceDir = '/tmp/repos-test-restack-cmd-source';
  const configPath = '/tmp/repos-test-restack-cmd-config/config.json';
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-restack-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('rebases on parent branch when parent exists', async () => {
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

    // Step 2: Add git config to parent
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      parentWorktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], parentWorktreePath);

    // Step 3: Make a commit on parent branch
    await Bun.write(join(parentWorktreePath, 'parent.txt'), 'parent content');
    await runGitCommand(['add', '.'], parentWorktreePath);
    await runGitCommand(['commit', '-m', 'parent commit'], parentWorktreePath);

    // Step 4: Stack a child branch from within parent worktree
    const childWorktreePath = join(testDir, 'bare.git-child-branch');
    process.chdir(parentWorktreePath);
    await stackCommand(ctx, 'child-branch');

    // Step 5: Add git config to child
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      childWorktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], childWorktreePath);

    // Step 6: Make a commit on child branch
    await Bun.write(join(childWorktreePath, 'child.txt'), 'child content');
    await runGitCommand(['add', '.'], childWorktreePath);
    await runGitCommand(['commit', '-m', 'child commit'], childWorktreePath);

    // Step 7: Make another commit on parent branch
    await Bun.write(join(parentWorktreePath, 'parent2.txt'), 'parent2 content');
    await runGitCommand(['add', '.'], parentWorktreePath);
    await runGitCommand(
      ['commit', '-m', 'parent commit 2'],
      parentWorktreePath
    );

    // Step 8: Restack from child worktree
    process.chdir(childWorktreePath);
    await restackCommand(ctx);

    // Verify child now has parent's second commit
    const logResult = await runGitCommand(
      ['log', '--oneline'],
      childWorktreePath
    );
    expect(logResult.stdout).toContain('parent commit 2');
    expect(logResult.stdout).toContain('child commit');
  });

  test('falls back to default branch when parent is gone', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config with pre-configured stack
    const config = {
      repos: [
        {
          name: 'bare',
          url: sourceDir,
          path: bareDir,
          bare: true,
          stacks: [{ parent: 'gone-parent', child: 'orphan-branch' }],
        },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create orphan worktree (the parent doesn't exist as a worktree)
    await workCommand(ctx, 'orphan-branch', 'bare');
    const orphanWorktreePath = join(testDir, 'bare.git-orphan-branch');

    // Add git config
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      orphanWorktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], orphanWorktreePath);

    // Make a commit
    await Bun.write(join(orphanWorktreePath, 'orphan.txt'), 'orphan content');
    await runGitCommand(['add', '.'], orphanWorktreePath);
    await runGitCommand(['commit', '-m', 'orphan commit'], orphanWorktreePath);

    // Restack should fall back to origin/main
    process.chdir(orphanWorktreePath);
    await restackCommand(ctx);

    // Verify the branch still has the orphan commit
    const logResult = await runGitCommand(
      ['log', '--oneline'],
      orphanWorktreePath
    );
    expect(logResult.stdout).toContain('orphan commit');

    // Verify the stale parent relationship was removed
    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'bare',
            url: sourceDir,
            path: bareDir,
            bare: true,
          },
        ],
      },
    });
  });

  test('fails when no parent is configured', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config without stacks
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create a worktree without stacking
    await workCommand(ctx, 'unstacked-branch', 'bare');
    const unstackedWorktreePath = join(testDir, 'bare.git-unstacked-branch');

    const mockExit = mockProcessExit();

    // Try to restack - should fail
    process.chdir(unstackedWorktreePath);
    await expect(restackCommand(ctx)).rejects.toThrow('process.exit(1)');
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  test('restack recursively restacks children by default', async () => {
    // Test that restack propagates changes through entire stack

    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create a stack: branch-a -> branch-b -> branch-c
    await workCommand(ctx, 'branch-a', 'bare');
    const branchAPath = join(testDir, 'bare.git-branch-a');
    await runGitCommand(['config', 'user.email', 'test@test.com'], branchAPath);
    await runGitCommand(['config', 'user.name', 'Test'], branchAPath);
    await Bun.write(join(branchAPath, 'file-a.txt'), 'content from a');
    await runGitCommand(['add', '.'], branchAPath);
    await runGitCommand(['commit', '-m', 'commit in a'], branchAPath);

    process.chdir(branchAPath);
    await stackCommand(ctx, 'branch-b');
    const branchBPath = join(testDir, 'bare.git-branch-b');
    await runGitCommand(['config', 'user.email', 'test@test.com'], branchBPath);
    await runGitCommand(['config', 'user.name', 'Test'], branchBPath);
    await Bun.write(join(branchBPath, 'file-b.txt'), 'content from b');
    await runGitCommand(['add', '.'], branchBPath);
    await runGitCommand(['commit', '-m', 'commit in b'], branchBPath);

    process.chdir(branchBPath);
    await stackCommand(ctx, 'branch-c');
    const branchCPath = join(testDir, 'bare.git-branch-c');
    await runGitCommand(['config', 'user.email', 'test@test.com'], branchCPath);
    await runGitCommand(['config', 'user.name', 'Test'], branchCPath);
    await Bun.write(join(branchCPath, 'file-c.txt'), 'content from c');
    await runGitCommand(['add', '.'], branchCPath);
    await runGitCommand(['commit', '-m', 'commit in c'], branchCPath);

    // Now add a new commit to branch-a
    await Bun.write(join(branchAPath, 'file-a2.txt'), 'more content from a');
    await runGitCommand(['add', '.'], branchAPath);
    await runGitCommand(['commit', '-m', 'second commit in a'], branchAPath);

    // Restack from branch-b (should also restack branch-c)
    process.chdir(branchBPath);
    await restackCommand(ctx);

    // Verify branch-b has the new commit from a
    const logB = await runGitCommand(['log', '--oneline'], branchBPath);
    expect(logB.stdout).toContain('second commit in a');
    expect(logB.stdout).toContain('commit in b');

    // Verify branch-c also has the new commit from a (propagated through b)
    const logC = await runGitCommand(['log', '--oneline'], branchCPath);
    expect(logC.stdout).toContain('second commit in a');
    expect(logC.stdout).toContain('commit in b');
    expect(logC.stdout).toContain('commit in c');
  });

  test('restack succeeds after parent commits are amended (fork point tracking)', async () => {
    // This test verifies the fix for the stacked branch rebase problem:
    // When parent's commits are rewritten (amend/rebase), child's restack
    // should use --onto with fork point to avoid conflicts

    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Step 1: Create branch-a worktree
    await workCommand(ctx, 'branch-a', 'bare');
    const branchAPath = join(testDir, 'bare.git-branch-a');
    await runGitCommand(['config', 'user.email', 'test@test.com'], branchAPath);
    await runGitCommand(['config', 'user.name', 'Test'], branchAPath);

    // Step 2: Make initial commit on branch-a
    await Bun.write(join(branchAPath, 'file-a.txt'), 'content from a');
    await runGitCommand(['add', '.'], branchAPath);
    await runGitCommand(['commit', '-m', 'commit in a'], branchAPath);

    // Get the commit hash before stacking
    const beforeStackResult = await runGitCommand(
      ['rev-parse', 'HEAD'],
      branchAPath
    );
    const originalACommit = beforeStackResult.stdout.trim();

    // Step 3: Stack branch-b on branch-a (this records fork point = originalACommit)
    process.chdir(branchAPath);
    await stackCommand(ctx, 'branch-b');
    const branchBPath = join(testDir, 'bare.git-branch-b');
    await runGitCommand(['config', 'user.email', 'test@test.com'], branchBPath);
    await runGitCommand(['config', 'user.name', 'Test'], branchBPath);

    // Step 4: Make a commit on branch-b
    await Bun.write(join(branchBPath, 'file-b.txt'), 'content from b');
    await runGitCommand(['add', '.'], branchBPath);
    await runGitCommand(['commit', '-m', 'commit in b'], branchBPath);

    // Step 5: Amend the commit on branch-a (this creates a new hash)
    // This simulates the scenario where the user modifies branch-a after stacking branch-b
    await Bun.write(join(branchAPath, 'file-a.txt'), 'amended content from a');
    await runGitCommand(['add', '.'], branchAPath);
    await runGitCommand(
      ['commit', '--amend', '-m', 'amended commit in a'],
      branchAPath
    );

    // Verify the commit hash changed
    const afterAmendResult = await runGitCommand(
      ['rev-parse', 'HEAD'],
      branchAPath
    );
    const amendedACommit = afterAmendResult.stdout.trim();
    expect(amendedACommit).not.toBe(originalACommit);

    // Step 6: Restack branch-b on branch-a
    // Without fork point tracking: git would try to apply the original commit from a,
    // causing conflicts because the file already has different content
    // With fork point tracking: git rebase --onto branch-a <fork-point> branch-b
    // only replays branch-b's commits, avoiding conflicts
    process.chdir(branchBPath);
    await restackCommand(ctx);

    // Verify branch-b has the amended commit from a and its own commit
    const logResult = await runGitCommand(['log', '--oneline'], branchBPath);
    expect(logResult.stdout).toContain('commit in b');
    expect(logResult.stdout).toContain('amended commit in a');

    // Verify branch-b has the amended content from branch-a
    const fileAContent = await Bun.file(join(branchBPath, 'file-a.txt')).text();
    expect(fileAContent).toBe('amended content from a');

    // Verify branch-b kept its own file
    expect(existsSync(join(branchBPath, 'file-b.txt'))).toBe(true);
  });
});

describe('repos unstack command', () => {
  const testDir = '/tmp/repos-test-unstack-cmd';
  const sourceDir = '/tmp/repos-test-unstack-cmd-source';
  const configPath = '/tmp/repos-test-unstack-cmd-config/config.json';
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-unstack-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('unstacks branch onto default branch and removes stack entry', async () => {
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

    // Step 2: Add git config to parent
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      parentWorktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], parentWorktreePath);

    // Step 3: Make a commit on parent branch
    await Bun.write(join(parentWorktreePath, 'parent.txt'), 'parent content');
    await runGitCommand(['add', '.'], parentWorktreePath);
    await runGitCommand(['commit', '-m', 'parent commit'], parentWorktreePath);

    // Step 4: Stack a child branch from within parent worktree
    const childWorktreePath = join(testDir, 'bare.git-child-branch');
    process.chdir(parentWorktreePath);
    await stackCommand(ctx, 'child-branch');

    // Step 5: Add git config to child
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      childWorktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], childWorktreePath);

    // Step 6: Make a commit on child branch
    await Bun.write(join(childWorktreePath, 'child.txt'), 'child content');
    await runGitCommand(['add', '.'], childWorktreePath);
    await runGitCommand(['commit', '-m', 'child commit'], childWorktreePath);

    // Verify stack relationship exists before unstack
    const configBefore = await readConfig(configPath);
    expect(configBefore).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'bare',
            url: sourceDir,
            path: bareDir,
            bare: true,
            stacks: [{ parent: 'parent-branch', child: 'child-branch' }],
          },
        ],
      },
    });

    // Step 7: Unstack from child worktree
    process.chdir(childWorktreePath);
    await unstackCommand(ctx);

    // Verify child still has its commit
    const logResult = await runGitCommand(
      ['log', '--oneline'],
      childWorktreePath
    );
    expect(logResult.stdout).toContain('child commit');

    // Verify the stack relationship was removed
    const configAfter = await readConfig(configPath);
    expect(configAfter).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'bare',
            url: sourceDir,
            path: bareDir,
            bare: true,
          },
        ],
      },
    });
  });

  test('fails when branch is not stacked', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config without stacks
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create a worktree without stacking
    await workCommand(ctx, 'unstacked-branch', 'bare');
    const unstackedWorktreePath = join(testDir, 'bare.git-unstacked-branch');

    const mockExit = mockProcessExit();

    // Try to unstack - should fail
    process.chdir(unstackedWorktreePath);
    await expect(unstackCommand(ctx)).rejects.toThrow('process.exit(1)');
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });
});

describe('repos continue command', () => {
  const testDir = '/tmp/repos-test-continue-cmd';
  const sourceDir = '/tmp/repos-test-continue-cmd-source';
  const configPath = '/tmp/repos-test-continue-cmd-config/config.json';
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-continue-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('fails when no rebase is in progress', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create a worktree
    await workCommand(ctx, 'feature-branch', 'bare');
    const worktreePath = join(testDir, 'bare.git-feature-branch');

    const mockExit = mockProcessExit();

    // Try to continue without a rebase in progress
    process.chdir(worktreePath);
    await expect(continueCommand(ctx)).rejects.toThrow('process.exit(1)');
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  test('continues rebase after conflict resolution and updates fork point', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create parent branch with initial commit
    await workCommand(ctx, 'parent-branch', 'bare');
    const parentPath = join(testDir, 'bare.git-parent-branch');
    await runGitCommand(['config', 'user.email', 'test@test.com'], parentPath);
    await runGitCommand(['config', 'user.name', 'Test'], parentPath);
    await Bun.write(join(parentPath, 'shared.txt'), 'parent version 1');
    await runGitCommand(['add', '.'], parentPath);
    await runGitCommand(['commit', '-m', 'parent initial'], parentPath);

    // Stack child branch - use the path from stdout instead of constructing it
    // This ensures we use the exact path git worktree knows about
    process.chdir(parentPath);
    await stackCommand(ctx, 'child-branch');
    const childPath = join(testDir, 'bare.git-child-branch');
    await runGitCommand(['config', 'user.email', 'test@test.com'], childPath);
    await runGitCommand(['config', 'user.name', 'Test'], childPath);

    // Child modifies the same file (will cause conflict)
    await Bun.write(join(childPath, 'shared.txt'), 'child version');
    await runGitCommand(['add', '.'], childPath);
    await runGitCommand(['commit', '-m', 'child commit'], childPath);

    // Parent modifies the same file (different change)
    await Bun.write(join(parentPath, 'shared.txt'), 'parent version 2');
    await runGitCommand(['add', '.'], parentPath);
    await runGitCommand(['commit', '-m', 'parent update'], parentPath);

    // Attempt restack from child - will fail with conflict
    process.chdir(childPath);
    const mockExit = mockProcessExit();
    await expect(restackCommand(ctx)).rejects.toThrow('process.exit(1)');
    mockExit.mockRestore();

    // Resolve the conflict
    await Bun.write(join(childPath, 'shared.txt'), 'resolved version');
    await runGitCommand(['add', '.'], childPath);

    // Continue the rebase (must be in the worktree directory)
    process.chdir(childPath);
    await continueCommand(ctx);

    // Verify the rebase completed
    const logResult = await runGitCommand(['log', '--oneline'], childPath);
    expect(logResult.stdout).toContain('child commit');
    expect(logResult.stdout).toContain('parent update');

    // Verify fork point ref was updated (by checking the base ref exists)
    const baseRefResult = await runGitCommand(
      ['rev-parse', 'refs/bases/child-branch'],
      bareDir
    );
    expect(baseRefResult.exitCode).toBe(0);

    // Verify the base ref points to parent's HEAD
    const parentHeadResult = await runGitCommand(
      ['rev-parse', 'HEAD'],
      parentPath
    );
    expect(baseRefResult.stdout.trim()).toBe(parentHeadResult.stdout.trim());
  });
});
