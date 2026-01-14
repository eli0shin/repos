import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { runGitCommand, cloneBare } from '../src/git.ts';
import { adoptCommand } from '../src/commands/adopt.ts';
import { readConfig, writeConfig } from '../src/config.ts';
import { arrayContaining } from './helpers.ts';

// Helper to create a test repo with commits and remote
async function createTestRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await runGitCommand(['init'], dir);
  await Bun.write(join(dir, 'test.txt'), 'test');
  await runGitCommand(['add', '.'], dir);
  await runGitCommand(['commit', '-m', 'initial'], dir);
}

// Helper to set up remote origin
async function addRemote(repoDir: string, url: string): Promise<void> {
  await runGitCommand(['remote', 'add', 'origin', url], repoDir);
}

describe('repos adopt with bare repos', () => {
  const testDir = '/tmp/repos-test-adopt-bare';
  const sourceDir = '/tmp/repos-test-adopt-bare-source';
  const configPath = '/tmp/repos-test-adopt-bare-config/config.json';
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
    await rm('/tmp/repos-test-adopt-bare-config', {
      recursive: true,
      force: true,
    });
  });

  test('adopts bare repo from parent directory', async () => {
    // Clone as bare repo
    const bareDir = join(testDir, 'project.git');
    await cloneBare(sourceDir, bareDir);

    // Initialize empty config
    await writeConfig(configPath, { repos: [] });

    // Run adopt from parent directory
    process.chdir(testDir);
    const ctx = { configPath };
    await adoptCommand(ctx);

    // Verify bare repo was adopted with bare: true
    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'project.git',
            url: sourceDir,
            path: realpathSync(bareDir),
            bare: true,
          },
        ],
      },
    });
  });

  test('adopts bare repo when running from inside bare repo', async () => {
    // Clone as bare repo with worktrees
    const bareDir = join(testDir, 'project.git');
    await cloneBare(sourceDir, bareDir);

    // Create a worktree inside the bare repo
    const mainWorktree = join(bareDir, 'main');
    await runGitCommand(['worktree', 'add', mainWorktree, 'HEAD'], bareDir);

    // Initialize empty config
    await writeConfig(configPath, { repos: [] });

    // Run adopt from inside bare repo
    process.chdir(bareDir);
    const ctx = { configPath };
    await adoptCommand(ctx);

    // Verify bare repo was adopted (not the worktrees)
    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'project.git',
            url: sourceDir,
            path: realpathSync(bareDir),
            bare: true,
          },
        ],
      },
    });
  });

  test('does not adopt worktrees inside bare repo as separate repos', async () => {
    // Clone as bare repo
    const bareDir = join(testDir, 'project.git');
    await cloneBare(sourceDir, bareDir);

    // Create worktrees inside the bare repo
    const mainWorktree = join(bareDir, 'main');
    const featureWorktree = join(bareDir, 'feature');
    await runGitCommand(['worktree', 'add', mainWorktree, 'HEAD'], bareDir);
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', featureWorktree],
      bareDir
    );

    // Initialize empty config
    await writeConfig(configPath, { repos: [] });

    // Run adopt from inside bare repo (which would scan subdirs)
    process.chdir(bareDir);
    const ctx = { configPath };
    await adoptCommand(ctx);

    // Verify only the bare repo was adopted, not the worktrees
    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'project.git',
            url: sourceDir,
            path: realpathSync(bareDir),
            bare: true,
          },
        ],
      },
    });
  });

  test('skips sibling directories that are worktrees of a bare repo', async () => {
    // Clone as bare repo
    const bareDir = join(testDir, 'project.git');
    await cloneBare(sourceDir, bareDir);

    // Create a sibling worktree (outside the bare repo directory)
    const siblingWorktree = join(testDir, 'project.git-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', siblingWorktree],
      bareDir
    );

    // Also create a regular repo to verify it still gets adopted
    const regularRepo = join(testDir, 'other-repo');
    await createTestRepo(regularRepo);
    await addRemote(regularRepo, 'git@github.com:user/other-repo.git');

    // Initialize empty config
    await writeConfig(configPath, { repos: [] });

    // Run adopt from parent directory
    process.chdir(testDir);
    const ctx = { configPath };
    await adoptCommand(ctx);

    // Verify bare repo and regular repo adopted, sibling worktree skipped
    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: {
        repos: arrayContaining([
          {
            name: 'project.git',
            url: sourceDir,
            path: realpathSync(bareDir),
            bare: true,
          },
          {
            name: 'other-repo',
            url: 'git@github.com:user/other-repo.git',
            path: realpathSync(regularRepo),
          },
        ]),
      },
    });
  });

  test('adopts regular repo with bare: undefined (not set)', async () => {
    // Create regular repo with remote
    const regularRepo = join(testDir, 'regular-repo');
    await createTestRepo(regularRepo);
    await addRemote(regularRepo, 'git@github.com:user/regular-repo.git');

    // Initialize empty config
    await writeConfig(configPath, { repos: [] });

    // Run adopt from parent directory
    process.chdir(testDir);
    const ctx = { configPath };
    await adoptCommand(ctx);

    // Verify regular repo does not have bare flag
    const configResult = await readConfig(configPath);
    expect(configResult).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'regular-repo',
            url: 'git@github.com:user/regular-repo.git',
            path: realpathSync(regularRepo),
          },
        ],
      },
    });
  });
});
