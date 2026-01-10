import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runGitCommand, cloneBare, isGitRepo } from '../src/git.ts';
import { workCommand } from '../src/commands/work.ts';
import { stackCommand } from '../src/commands/stack.ts';
import { collapseCommand } from '../src/commands/collapse.ts';
import { writeConfig, readConfig } from '../src/config.ts';
import type { ReposConfig } from '../src/types.ts';
import { mockProcessExit, type MockExit } from './utils.ts';

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

describe('repos collapse command', () => {
  const testDir = '/tmp/repos-test-collapse-cmd';
  const sourceDir = '/tmp/repos-test-collapse-cmd-source';
  const configPath = '/tmp/repos-test-collapse-cmd-config/config.json';
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
    await rm('/tmp/repos-test-collapse-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('collapses parent into child branch', async () => {
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
    const childWorktreePath = join(testDir, 'bare.git-child-branch');

    // Step 2: Add git config and make commits on parent
    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      parentWorktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], parentWorktreePath);
    await Bun.write(join(parentWorktreePath, 'parent.txt'), 'parent content');
    await runGitCommand(['add', '.'], parentWorktreePath);
    await runGitCommand(['commit', '-m', 'parent commit'], parentWorktreePath);

    // Step 3: Stack child branch
    const originalCwd = process.cwd();
    process.chdir(parentWorktreePath);
    try {
      await stackCommand(ctx, 'child-branch');

      // Step 4: Add git config and make commits on child
      await runGitCommand(
        ['config', 'user.email', 'test@test.com'],
        childWorktreePath
      );
      await runGitCommand(['config', 'user.name', 'Test'], childWorktreePath);
      await Bun.write(join(childWorktreePath, 'child.txt'), 'child content');
      await runGitCommand(['add', '.'], childWorktreePath);
      await runGitCommand(['commit', '-m', 'child commit'], childWorktreePath);

      // Verify stack exists before collapse
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

      // Step 5: Collapse from child worktree
      process.chdir(childWorktreePath);
      await collapseCommand(ctx);

      // Verify parent worktree was removed
      expect(await isGitRepo(parentWorktreePath)).toBe(false);

      // Verify child worktree still exists
      expect(await isGitRepo(childWorktreePath)).toBe(true);

      // Verify child has both commits (parent's and its own)
      const logResult = await runGitCommand(
        ['log', '--oneline'],
        childWorktreePath
      );
      expect(logResult.stdout).toContain('parent commit');
      expect(logResult.stdout).toContain('child commit');

      // Verify stack entry was removed (child is now independent)
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
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('collapses to grandparent in multi-level stack', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create A -> B -> C stack
    await workCommand(ctx, 'branch-a', 'bare');
    const pathA = join(testDir, 'bare.git-branch-a');
    const pathB = join(testDir, 'bare.git-branch-b');
    const pathC = join(testDir, 'bare.git-branch-c');

    // Configure git for all worktrees
    await runGitCommand(['config', 'user.email', 'test@test.com'], pathA);
    await runGitCommand(['config', 'user.name', 'Test'], pathA);
    await Bun.write(join(pathA, 'a.txt'), 'a content');
    await runGitCommand(['add', '.'], pathA);
    await runGitCommand(['commit', '-m', 'commit A'], pathA);

    const originalCwd = process.cwd();
    process.chdir(pathA);
    try {
      await stackCommand(ctx, 'branch-b');

      await runGitCommand(['config', 'user.email', 'test@test.com'], pathB);
      await runGitCommand(['config', 'user.name', 'Test'], pathB);
      await Bun.write(join(pathB, 'b.txt'), 'b content');
      await runGitCommand(['add', '.'], pathB);
      await runGitCommand(['commit', '-m', 'commit B'], pathB);

      process.chdir(pathB);
      await stackCommand(ctx, 'branch-c');

      await runGitCommand(['config', 'user.email', 'test@test.com'], pathC);
      await runGitCommand(['config', 'user.name', 'Test'], pathC);
      await Bun.write(join(pathC, 'c.txt'), 'c content');
      await runGitCommand(['add', '.'], pathC);
      await runGitCommand(['commit', '-m', 'commit C'], pathC);

      // Verify 3-level stack exists
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
              stacks: [
                { parent: 'branch-a', child: 'branch-b' },
                { parent: 'branch-b', child: 'branch-c' },
              ],
            },
          ],
        },
      });

      // Collapse from C (should collapse B into C, keeping A -> C)
      process.chdir(pathC);
      await collapseCommand(ctx);

      // Verify B worktree was removed
      expect(await isGitRepo(pathB)).toBe(false);

      // Verify A and C worktrees still exist
      expect(await isGitRepo(pathA)).toBe(true);
      expect(await isGitRepo(pathC)).toBe(true);

      // Verify C now has A as parent
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
              stacks: [{ parent: 'branch-a', child: 'branch-c' }],
            },
          ],
        },
      });

      // Verify C has all commits
      const logResult = await runGitCommand(['log', '--oneline'], pathC);
      expect(logResult.stdout).toContain('commit A');
      expect(logResult.stdout).toContain('commit B');
      expect(logResult.stdout).toContain('commit C');
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

    // Try to collapse from outside a worktree
    const originalCwd = process.cwd();
    process.chdir(bareDir);
    try {
      await expect(collapseCommand(ctx)).rejects.toThrow('process.exit(1)');
      expect(mockExit).toHaveBeenCalledWith(1);
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

    // Try to collapse - should fail
    const originalCwd = process.cwd();
    process.chdir(unstackedWorktreePath);
    try {
      await expect(collapseCommand(ctx)).rejects.toThrow('process.exit(1)');
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('fails when parent has sibling children', async () => {
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
    const child1Path = join(testDir, 'bare.git-child-1');
    const child2Path = join(testDir, 'bare.git-child-2');

    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      parentWorktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], parentWorktreePath);
    await Bun.write(join(parentWorktreePath, 'parent.txt'), 'parent content');
    await runGitCommand(['add', '.'], parentWorktreePath);
    await runGitCommand(['commit', '-m', 'parent commit'], parentWorktreePath);

    const originalCwd = process.cwd();
    process.chdir(parentWorktreePath);
    try {
      // Stack two children
      await stackCommand(ctx, 'child-1');
      await stackCommand(ctx, 'child-2');

      // Verify both children exist
      expect(await isGitRepo(child1Path)).toBe(true);
      expect(await isGitRepo(child2Path)).toBe(true);

      // Try to collapse from child-1 - should fail because child-2 is a sibling
      process.chdir(child1Path);
      await expect(collapseCommand(ctx)).rejects.toThrow('process.exit(1)');
      expect(mockExit).toHaveBeenCalledWith(1);

      // Verify nothing was changed
      expect(await isGitRepo(parentWorktreePath)).toBe(true);
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
              stacks: [
                { parent: 'parent-branch', child: 'child-1' },
                { parent: 'parent-branch', child: 'child-2' },
              ],
            },
          ],
        },
      });
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('fails when parent worktree has uncommitted changes', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Create config
    const config = {
      repos: [{ name: 'bare', url: sourceDir, path: bareDir, bare: true }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    const ctx = { configPath };

    // Create parent and child
    await workCommand(ctx, 'parent-branch', 'bare');
    const parentWorktreePath = join(testDir, 'bare.git-parent-branch');
    const childWorktreePath = join(testDir, 'bare.git-child-branch');

    await runGitCommand(
      ['config', 'user.email', 'test@test.com'],
      parentWorktreePath
    );
    await runGitCommand(['config', 'user.name', 'Test'], parentWorktreePath);
    await Bun.write(join(parentWorktreePath, 'parent.txt'), 'parent content');
    await runGitCommand(['add', '.'], parentWorktreePath);
    await runGitCommand(['commit', '-m', 'parent commit'], parentWorktreePath);

    const originalCwd = process.cwd();
    process.chdir(parentWorktreePath);
    try {
      await stackCommand(ctx, 'child-branch');

      // Add uncommitted changes to parent
      await Bun.write(join(parentWorktreePath, 'dirty.txt'), 'dirty');

      // Try to collapse - should fail due to uncommitted changes
      process.chdir(childWorktreePath);
      await expect(collapseCommand(ctx)).rejects.toThrow('process.exit(1)');
      expect(mockExit).toHaveBeenCalledWith(1);

      // Verify parent worktree still exists
      expect(await isGitRepo(parentWorktreePath)).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
