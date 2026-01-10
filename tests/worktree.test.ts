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
import { stackCommand } from '../src/commands/stack.ts';
import { restackCommand } from '../src/commands/restack.ts';
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
    await cleanCommand(ctx, 'parent', 'bare', { force: true });

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

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
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
    const originalCwd = process.cwd();
    process.chdir(parentWorktreePath);
    try {
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
      expect(configResult.success).toBe(true);
      if (configResult.success) {
        const repo = configResult.data.repos.find((r) => r.name === 'bare');
        expect(repo?.stacks).toEqual([
          { parent: 'parent-branch', child: 'child-branch' },
        ]);
      }
    } finally {
      process.chdir(originalCwd);
    }
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
    const originalCwd = process.cwd();
    process.chdir(bareDir);
    try {
      await expect(stackCommand(ctx, 'child-branch')).rejects.toThrow(
        'process.exit(1)'
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      process.chdir(originalCwd);
      mockExit.mockRestore();
    }
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
    const originalCwd = process.cwd();
    process.chdir(parentWorktreePath);
    try {
      await expect(stackCommand(ctx, 'existing-branch')).rejects.toThrow(
        'process.exit(1)'
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      process.chdir(originalCwd);
      mockExit.mockRestore();
    }
  });
});

describe('repos restack command', () => {
  const testDir = '/tmp/repos-test-restack-cmd';
  const sourceDir = '/tmp/repos-test-restack-cmd-source';
  const configPath = '/tmp/repos-test-restack-cmd-config/config.json';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
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
    const originalCwd = process.cwd();
    process.chdir(parentWorktreePath);
    try {
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
      await Bun.write(
        join(parentWorktreePath, 'parent2.txt'),
        'parent2 content'
      );
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
    } finally {
      process.chdir(originalCwd);
    }
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
    const originalCwd = process.cwd();
    process.chdir(orphanWorktreePath);
    try {
      await restackCommand(ctx);

      // Verify the branch still has the orphan commit
      const logResult = await runGitCommand(
        ['log', '--oneline'],
        orphanWorktreePath
      );
      expect(logResult.stdout).toContain('orphan commit');

      // Verify the stale parent relationship was removed
      const configResult = await readConfig(configPath);
      expect(configResult.success).toBe(true);
      if (configResult.success) {
        const repo = configResult.data.repos.find((r) => r.name === 'bare');
        expect(repo?.stacks).toBeUndefined();
      }
    } finally {
      process.chdir(originalCwd);
    }
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
    const originalCwd = process.cwd();
    process.chdir(unstackedWorktreePath);
    try {
      await expect(restackCommand(ctx)).rejects.toThrow('process.exit(1)');
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      process.chdir(originalCwd);
      mockExit.mockRestore();
    }
  });
});

describe('repos unstack command', () => {
  const testDir = '/tmp/repos-test-unstack-cmd';
  const sourceDir = '/tmp/repos-test-unstack-cmd-source';
  const configPath = '/tmp/repos-test-unstack-cmd-config/config.json';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
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
    const originalCwd = process.cwd();
    process.chdir(parentWorktreePath);
    try {
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
      expect(configBefore.success).toBe(true);
      if (configBefore.success) {
        const repo = configBefore.data.repos.find((r) => r.name === 'bare');
        expect(repo?.stacks).toEqual([
          { parent: 'parent-branch', child: 'child-branch' },
        ]);
      }

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
      expect(configAfter.success).toBe(true);
      if (configAfter.success) {
        const repo = configAfter.data.repos.find((r) => r.name === 'bare');
        expect(repo?.stacks).toBeUndefined();
      }
    } finally {
      process.chdir(originalCwd);
    }
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
    const originalCwd = process.cwd();
    process.chdir(unstackedWorktreePath);
    try {
      await expect(unstackCommand(ctx)).rejects.toThrow('process.exit(1)');
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      process.chdir(originalCwd);
      mockExit.mockRestore();
    }
  });
});
