import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  runGitCommand,
  getCurrentBranch,
  isGitRepo,
  findGitRepos,
  getRemoteUrl,
  cloneRepo,
  pullCurrentBranch,
} from '../src/git.ts';

describe('runGitCommand', () => {
  test('runs git version successfully', async () => {
    const result = await runGitCommand(['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('git version');
  });

  test('returns non-zero exit code for invalid command', async () => {
    const result = await runGitCommand(['invalid-command-that-does-not-exist']);
    expect(result.exitCode).not.toBe(0);
  });
});

describe('isGitRepo', () => {
  const testDir = '/tmp/repos-test-git';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('returns true for a git repository', async () => {
    await runGitCommand(['init'], testDir);
    const result = await isGitRepo(testDir);
    expect(result).toBe(true);
  });

  test('returns false for a non-git directory', async () => {
    const result = await isGitRepo(testDir);
    expect(result).toBe(false);
  });

  test('returns false for non-existent directory', async () => {
    const result = await isGitRepo('/tmp/does-not-exist-xyz');
    expect(result).toBe(false);
  });
});

describe('getCurrentBranch', () => {
  const testDir = '/tmp/repos-test-branch';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await runGitCommand(['init'], testDir);
    await runGitCommand(['config', 'user.email', 'test@test.com'], testDir);
    await runGitCommand(['config', 'user.name', 'Test'], testDir);
    // Create initial commit so branch exists
    await Bun.write(join(testDir, 'test.txt'), 'test');
    await runGitCommand(['add', '.'], testDir);
    await runGitCommand(['commit', '-m', 'initial'], testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('returns current branch name', async () => {
    const result = await getCurrentBranch(testDir);
    expect(result.success).toBe(true);
    if (result.success) {
      // Default branch could be 'main' or 'master' depending on git config
      expect(result.data === 'main' || result.data === 'master').toBe(true);
    }
  });

  test('returns branch name after checkout', async () => {
    await runGitCommand(['checkout', '-b', 'feature'], testDir);
    const result = await getCurrentBranch(testDir);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('feature');
    }
  });

  test('returns error for non-git directory', async () => {
    const result = await getCurrentBranch('/tmp');
    expect(result.success).toBe(false);
  });
});

describe('findGitRepos', () => {
  const testDir = '/tmp/repos-test-find';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    // Create two git repos and one regular directory
    await mkdir(join(testDir, 'repo1'), { recursive: true });
    await mkdir(join(testDir, 'repo2'), { recursive: true });
    await mkdir(join(testDir, 'not-a-repo'), { recursive: true });

    await runGitCommand(['init'], join(testDir, 'repo1'));
    await runGitCommand(['init'], join(testDir, 'repo2'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('finds all git repos in directory', async () => {
    const repos = await findGitRepos(testDir);
    expect(repos).toHaveLength(2);
    expect(repos).toContain('repo1');
    expect(repos).toContain('repo2');
  });

  test('does not include non-git directories', async () => {
    const repos = await findGitRepos(testDir);
    expect(repos).not.toContain('not-a-repo');
  });

  test('returns empty array for directory with no repos', async () => {
    await mkdir(join(testDir, 'empty'), { recursive: true });
    const repos = await findGitRepos(join(testDir, 'empty'));
    expect(repos).toHaveLength(0);
  });
});

describe('getRemoteUrl', () => {
  const testDir = '/tmp/repos-test-remote';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await runGitCommand(['init'], testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('returns remote URL when set', async () => {
    await runGitCommand(
      ['remote', 'add', 'origin', 'git@github.com:user/repo.git'],
      testDir
    );
    const result = await getRemoteUrl(testDir);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('git@github.com:user/repo.git');
    }
  });

  test('returns error when no remote', async () => {
    const result = await getRemoteUrl(testDir);
    expect(result.success).toBe(false);
  });
});

describe('cloneRepo', () => {
  const testDir = '/tmp/repos-test-clone';
  const sourceDir = '/tmp/repos-test-clone-source';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    // Create a source repo to clone from
    await mkdir(sourceDir, { recursive: true });
    await runGitCommand(['init'], sourceDir);
    await runGitCommand(['config', 'user.email', 'test@test.com'], sourceDir);
    await runGitCommand(['config', 'user.name', 'Test'], sourceDir);
    await Bun.write(join(sourceDir, 'test.txt'), 'test');
    await runGitCommand(['add', '.'], sourceDir);
    await runGitCommand(['commit', '-m', 'initial'], sourceDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  });

  test('clones a repository successfully', async () => {
    const targetDir = join(testDir, 'cloned');
    const result = await cloneRepo(sourceDir, targetDir);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        result.data.branch === 'main' || result.data.branch === 'master'
      ).toBe(true);
    }
    expect(await isGitRepo(targetDir)).toBe(true);
  });

  test('returns error when target already exists', async () => {
    const targetDir = join(testDir, 'existing');
    await mkdir(targetDir, { recursive: true });
    await Bun.write(join(targetDir, 'file.txt'), 'exists');

    const result = await cloneRepo(sourceDir, targetDir);
    expect(result.success).toBe(false);
  });
});

describe('pullCurrentBranch', () => {
  const testDir = '/tmp/repos-test-pull';
  const remoteDir = '/tmp/repos-test-pull-remote';

  beforeEach(async () => {
    // Create a "remote" repo
    await mkdir(remoteDir, { recursive: true });
    await runGitCommand(['init', '--bare'], remoteDir);

    // Clone it to create local repo
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  test('pulls successfully when up to date', async () => {
    // Clone the bare repo
    const localDir = join(testDir, 'local');
    await runGitCommand(['clone', remoteDir, localDir]);
    await runGitCommand(['config', 'user.email', 'test@test.com'], localDir);
    await runGitCommand(['config', 'user.name', 'Test'], localDir);

    // Create initial commit and push
    await Bun.write(join(localDir, 'test.txt'), 'test');
    await runGitCommand(['add', '.'], localDir);
    await runGitCommand(['commit', '-m', 'initial'], localDir);
    await runGitCommand(['push', '-u', 'origin', 'HEAD'], localDir);

    const result = await pullCurrentBranch(localDir);
    expect(result.success).toBe(true);
  });

  test('returns error for non-git directory', async () => {
    const result = await pullCurrentBranch(testDir);
    expect(result.success).toBe(false);
  });
});
