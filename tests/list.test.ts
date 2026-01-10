import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runGitCommand, cloneBare } from '../src/git.ts';
import { listCommand } from '../src/commands/list.ts';
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
function captureOutput(): { output: string[]; restore: () => void } {
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

describe('repos list command - auto-detect repo', () => {
  const testDir = '/tmp/repos-test-list-cmd';
  const sourceDir1 = '/tmp/repos-test-list-cmd-source1';
  const sourceDir2 = '/tmp/repos-test-list-cmd-source2';
  const configPath = '/tmp/repos-test-list-cmd-config/config.json';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir1);
    await createTestRepo(sourceDir2);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir1, { recursive: true, force: true });
    await rm(sourceDir2, { recursive: true, force: true });
    await rm('/tmp/repos-test-list-cmd-config', {
      recursive: true,
      force: true,
    });
  });

  test('shows only current repo when inside a tracked repo worktree', async () => {
    // Setup: Create two bare repos with worktrees
    const bareDir1 = join(testDir, 'bare1.git');
    const bareDir2 = join(testDir, 'bare2.git');
    await cloneBare(sourceDir1, bareDir1);
    await cloneBare(sourceDir2, bareDir2);

    // Create worktrees for both repos
    const wt1Path = join(testDir, 'bare1.git-feature');
    const wt2Path = join(testDir, 'bare2.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', wt1Path],
      bareDir1
    );
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', wt2Path],
      bareDir2
    );

    // Create config with both repos
    const config = {
      repos: [
        { name: 'repo1', url: sourceDir1, path: bareDir1, bare: true },
        { name: 'repo2', url: sourceDir2, path: bareDir2, bare: true },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Change cwd to inside repo1's worktree
    const originalCwd = process.cwd();
    process.chdir(wt1Path);
    try {
      const capture = captureOutput();
      await listCommand({ configPath });
      capture.restore();

      const output = capture.output.join('');
      // Should show repo1
      expect(output).toContain('repo1');
      expect(output).toContain('feature');
      // Should NOT show repo2
      expect(output).not.toContain('repo2');
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('shows all repos when outside any tracked repo', async () => {
    // Setup: Create two bare repos
    const bareDir1 = join(testDir, 'bare1.git');
    const bareDir2 = join(testDir, 'bare2.git');
    await cloneBare(sourceDir1, bareDir1);
    await cloneBare(sourceDir2, bareDir2);

    // Create config with both repos
    const config = {
      repos: [
        { name: 'repo1', url: sourceDir1, path: bareDir1, bare: true },
        { name: 'repo2', url: sourceDir2, path: bareDir2, bare: true },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run from outside both repos (testDir parent)
    const originalCwd = process.cwd();
    process.chdir('/tmp');
    try {
      const capture = captureOutput();
      await listCommand({ configPath });
      capture.restore();

      const output = capture.output.join('');
      // Should show both repos
      expect(output).toContain('repo1');
      expect(output).toContain('repo2');
      expect(output).toContain('Tracked repositories');
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('shows worktrees with stack relationships in tree format', async () => {
    // Setup: Create bare repo with stacked worktrees
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir1, bareDir);

    // Create parent and child worktrees
    const parentPath = join(testDir, 'bare.git-parent');
    const childPath = join(testDir, 'bare.git-child');
    await runGitCommand(
      ['worktree', 'add', '-b', 'parent', parentPath],
      bareDir
    );
    await runGitCommand(['worktree', 'add', '-b', 'child', childPath], bareDir);

    // Create config with stack relationship
    const config = {
      repos: [
        {
          name: 'repo',
          url: sourceDir1,
          path: bareDir,
          bare: true,
          stacks: [{ parent: 'parent', child: 'child' }],
        },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run from inside the repo
    const originalCwd = process.cwd();
    process.chdir(parentPath);
    try {
      const capture = captureOutput();
      await listCommand({ configPath });
      capture.restore();

      const output = capture.output.join('');
      // Should show parent branch
      expect(output).toContain('parent');
      // Should show child branch with stacked label
      expect(output).toContain('child');
      expect(output).toContain('(stacked)');
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('auto-detects repo when inside the bare repo directory', async () => {
    // Setup: Create two bare repos
    const bareDir1 = join(testDir, 'bare1.git');
    const bareDir2 = join(testDir, 'bare2.git');
    await cloneBare(sourceDir1, bareDir1);
    await cloneBare(sourceDir2, bareDir2);

    // Create worktree for repo1
    const wt1Path = join(testDir, 'bare1.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', wt1Path],
      bareDir1
    );

    // Create config with both repos
    const config = {
      repos: [
        { name: 'repo1', url: sourceDir1, path: bareDir1, bare: true },
        { name: 'repo2', url: sourceDir2, path: bareDir2, bare: true },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run from inside bare repo1 directory
    const originalCwd = process.cwd();
    process.chdir(bareDir1);
    try {
      const capture = captureOutput();
      await listCommand({ configPath });
      capture.restore();

      const output = capture.output.join('');
      // Should show repo1
      expect(output).toContain('repo1');
      expect(output).toContain('feature');
      // Should NOT show repo2
      expect(output).not.toContain('repo2');
    } finally {
      process.chdir(originalCwd);
    }
  });
});
