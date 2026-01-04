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
  isBareRepo,
  getDefaultBranch,
  listWorktrees,
  createWorktree,
  removeWorktree,
  hasUncommittedChanges,
  fetchOrigin,
  rebaseOnBranch,
  cloneBare,
  ensureRefspecConfig,
} from '../src/git.ts';

function matchString(regex: RegExp): string {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return expect.stringMatching(regex) as unknown as string;
}

describe('runGitCommand', () => {
  test('runs git version successfully', async () => {
    expect(await runGitCommand(['--version'])).toEqual({
      stdout: matchString(/^git version \d+\.\d+\.\d+/),
      stderr: '',
      exitCode: 0,
    });
  });

  test('returns non-zero exit code for invalid command', async () => {
    const result = await runGitCommand(['invalid-command-that-does-not-exist']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/not a git command/i);
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
    expect(await getCurrentBranch(testDir)).toSatisfy(
      (r: { success: boolean; data?: string }) =>
        r.success === true && (r.data === 'main' || r.data === 'master')
    );
  });

  test('returns branch name after checkout', async () => {
    await runGitCommand(['checkout', '-b', 'feature'], testDir);
    expect(await getCurrentBranch(testDir)).toEqual({
      success: true,
      data: 'feature',
    });
  });

  test('returns error for non-git directory', async () => {
    expect(await getCurrentBranch('/tmp')).toEqual({
      success: false,
      error: matchString(/fatal|not a git repository/i),
    });
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
    expect(repos.sort()).toEqual(['repo1', 'repo2']);
  });

  test('does not include non-git directories', async () => {
    const repos = await findGitRepos(testDir);
    expect(repos.sort()).toEqual(['repo1', 'repo2']);
  });

  test('returns empty array for directory with no repos', async () => {
    await mkdir(join(testDir, 'empty'), { recursive: true });
    expect(await findGitRepos(join(testDir, 'empty'))).toEqual([]);
  });

  test('finds bare repos in directory', async () => {
    const bareDir = join(testDir, 'bare.git');
    await runGitCommand(['init', '--bare', bareDir]);
    const repos = await findGitRepos(testDir);
    expect(repos.sort()).toEqual(['bare.git', 'repo1', 'repo2']);
  });

  test('finds both bare and regular repos', async () => {
    const bareDir = join(testDir, 'project.git');
    await runGitCommand(['init', '--bare', bareDir]);
    const repos = await findGitRepos(testDir);
    expect(repos.sort()).toEqual(['project.git', 'repo1', 'repo2']);
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
    expect(await getRemoteUrl(testDir)).toEqual({
      success: true,
      data: 'git@github.com:user/repo.git',
    });
  });

  test('returns error when no remote', async () => {
    expect(await getRemoteUrl(testDir)).toEqual({
      success: false,
      error: 'No remote origin found',
    });
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
    expect(result).toSatisfy(
      (r: { success: boolean; data?: { branch: string } }) =>
        r.success === true &&
        (r.data?.branch === 'main' || r.data?.branch === 'master')
    );
    expect(await isGitRepo(targetDir)).toBe(true);
  });

  test('returns error when target already exists', async () => {
    const targetDir = join(testDir, 'existing');
    await mkdir(targetDir, { recursive: true });
    await Bun.write(join(targetDir, 'file.txt'), 'exists');

    expect(await cloneRepo(sourceDir, targetDir)).toEqual({
      success: false,
      error: 'Target directory already exists and is not empty',
    });
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

    expect(await pullCurrentBranch(localDir)).toEqual({
      success: true,
      data: { updated: false },
    });
  });

  test('returns error for non-git directory', async () => {
    expect(await pullCurrentBranch(testDir)).toEqual({
      success: false,
      error: matchString(/fatal|not a git repository/i),
    });
  });
});

describe('isBareRepo', () => {
  const testDir = '/tmp/repos-test-bare';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('returns true for bare repository', async () => {
    const bareDir = join(testDir, 'bare.git');
    await runGitCommand(['init', '--bare', bareDir]);
    expect(await isBareRepo(bareDir)).toBe(true);
  });

  test('returns false for non-bare repository', async () => {
    const repoDir = join(testDir, 'repo');
    await mkdir(repoDir, { recursive: true });
    await runGitCommand(['init'], repoDir);
    expect(await isBareRepo(repoDir)).toBe(false);
  });

  test('returns false for non-git directory', async () => {
    expect(await isBareRepo(testDir)).toBe(false);
  });
});

describe('getDefaultBranch', () => {
  const testDir = '/tmp/repos-test-default-branch';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await runGitCommand(['init'], testDir);
    await runGitCommand(['config', 'user.email', 'test@test.com'], testDir);
    await runGitCommand(['config', 'user.name', 'Test'], testDir);
    await Bun.write(join(testDir, 'test.txt'), 'test');
    await runGitCommand(['add', '.'], testDir);
    await runGitCommand(['commit', '-m', 'initial'], testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('returns default branch from local HEAD', async () => {
    const result = await getDefaultBranch(testDir);
    expect(result).toSatisfy(
      (r: { success: boolean; data?: string }) =>
        r.success === true && (r.data === 'main' || r.data === 'master')
    );
  });
});

describe('hasUncommittedChanges', () => {
  const testDir = '/tmp/repos-test-changes';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await runGitCommand(['init'], testDir);
    await runGitCommand(['config', 'user.email', 'test@test.com'], testDir);
    await runGitCommand(['config', 'user.name', 'Test'], testDir);
    await Bun.write(join(testDir, 'test.txt'), 'test');
    await runGitCommand(['add', '.'], testDir);
    await runGitCommand(['commit', '-m', 'initial'], testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('returns false when working tree is clean', async () => {
    expect(await hasUncommittedChanges(testDir)).toEqual({
      success: true,
      data: false,
    });
  });

  test('returns true when there are uncommitted changes', async () => {
    await Bun.write(join(testDir, 'new-file.txt'), 'new content');
    expect(await hasUncommittedChanges(testDir)).toEqual({
      success: true,
      data: true,
    });
  });

  test('returns true when there are staged changes', async () => {
    await Bun.write(join(testDir, 'staged.txt'), 'staged');
    await runGitCommand(['add', 'staged.txt'], testDir);
    expect(await hasUncommittedChanges(testDir)).toEqual({
      success: true,
      data: true,
    });
  });
});

describe('cloneBare', () => {
  const testDir = '/tmp/repos-test-clone-bare';
  const sourceDir = '/tmp/repos-test-clone-bare-source';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
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

  test('clones a repository as bare', async () => {
    const targetDir = join(testDir, 'cloned.git');
    const result = await cloneBare(sourceDir, targetDir);
    expect(result).toEqual({ success: true, data: undefined });
    expect(await isBareRepo(targetDir)).toBe(true);
  });

  test('returns error when target already exists', async () => {
    const targetDir = join(testDir, 'existing');
    await mkdir(targetDir, { recursive: true });
    await Bun.write(join(targetDir, 'file.txt'), 'exists');

    expect(await cloneBare(sourceDir, targetDir)).toEqual({
      success: false,
      error: 'Target directory already exists and is not empty',
    });
  });
});

describe('listWorktrees', () => {
  const testDir = '/tmp/repos-test-worktrees';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('lists worktrees for a regular repo', async () => {
    const repoDir = join(testDir, 'repo');
    await mkdir(repoDir, { recursive: true });
    await runGitCommand(['init'], repoDir);
    await runGitCommand(['config', 'user.email', 'test@test.com'], repoDir);
    await runGitCommand(['config', 'user.name', 'Test'], repoDir);
    await Bun.write(join(repoDir, 'test.txt'), 'test');
    await runGitCommand(['add', '.'], repoDir);
    await runGitCommand(['commit', '-m', 'initial'], repoDir);

    const result = await listWorktrees(repoDir);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
      // On macOS, /tmp is symlinked to /private/tmp, so check end of path
      expect(result.data[0].path).toEndWith('repos-test-worktrees/repo');
      expect(result.data[0].isMain).toBe(true);
    }
  });

  test('lists worktrees for a bare repo with worktree', async () => {
    // Create source repo
    const sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });
    await runGitCommand(['init'], sourceDir);
    await runGitCommand(['config', 'user.email', 'test@test.com'], sourceDir);
    await runGitCommand(['config', 'user.name', 'Test'], sourceDir);
    await Bun.write(join(sourceDir, 'test.txt'), 'test');
    await runGitCommand(['add', '.'], sourceDir);
    await runGitCommand(['commit', '-m', 'initial'], sourceDir);

    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Add a worktree
    const worktreeDir = join(testDir, 'worktree-feature');
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreeDir],
      bareDir
    );

    const result = await listWorktrees(bareDir);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(2);
      const mainWorktree = result.data.find((w) => w.isMain);
      const featureWorktree = result.data.find((w) => w.branch === 'feature');
      expect(mainWorktree).toBeDefined();
      expect(featureWorktree).toBeDefined();
      // On macOS, /tmp is symlinked to /private/tmp, so check end of path
      expect(featureWorktree?.path).toEndWith(
        'repos-test-worktrees/worktree-feature'
      );
    }
  });
});

describe('createWorktree and removeWorktree', () => {
  const testDir = '/tmp/repos-test-worktree-ops';
  const sourceDir = '/tmp/repos-test-worktree-ops-source';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    // Create source repo
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

  test('creates and removes a worktree', async () => {
    // Clone as bare
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir, bareDir);

    // Ensure refspec is configured (normally done by command layer)
    await ensureRefspecConfig(bareDir);

    // Create worktree
    const worktreeDir = join(testDir, 'worktree-test');
    const createResult = await createWorktree(
      bareDir,
      worktreeDir,
      'test-branch'
    );
    expect(createResult).toEqual({ success: true, data: undefined });

    // Verify worktree exists
    expect(await isGitRepo(worktreeDir)).toBe(true);
    const branchResult = await getCurrentBranch(worktreeDir);
    expect(branchResult).toEqual({ success: true, data: 'test-branch' });

    // Remove worktree
    const removeResult = await removeWorktree(bareDir, worktreeDir);
    expect(removeResult).toEqual({ success: true, data: undefined });

    // Verify worktree is gone
    expect(await isGitRepo(worktreeDir)).toBe(false);
  });
});

describe('fetchOrigin', () => {
  const testDir = '/tmp/repos-test-fetch';
  const remoteDir = '/tmp/repos-test-fetch-remote';

  beforeEach(async () => {
    // Create a "remote" repo
    await mkdir(remoteDir, { recursive: true });
    await runGitCommand(['init', '--bare'], remoteDir);

    // Create local clone
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  test('fetches from origin successfully', async () => {
    const localDir = join(testDir, 'local');
    await runGitCommand(['clone', remoteDir, localDir]);
    await runGitCommand(['config', 'user.email', 'test@test.com'], localDir);
    await runGitCommand(['config', 'user.name', 'Test'], localDir);

    // Create initial commit and push
    await Bun.write(join(localDir, 'test.txt'), 'test');
    await runGitCommand(['add', '.'], localDir);
    await runGitCommand(['commit', '-m', 'initial'], localDir);
    await runGitCommand(['push', '-u', 'origin', 'HEAD'], localDir);

    const result = await fetchOrigin(localDir);
    expect(result).toEqual({ success: true, data: undefined });
  });
});

describe('rebaseOnBranch', () => {
  const testDir = '/tmp/repos-test-rebase';
  const remoteDir = '/tmp/repos-test-rebase-remote';

  beforeEach(async () => {
    // Create a "remote" repo
    await mkdir(remoteDir, { recursive: true });
    await runGitCommand(['init', '--bare'], remoteDir);

    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  test('rebases branch on target successfully', async () => {
    const localDir = join(testDir, 'local');
    await runGitCommand(['clone', remoteDir, localDir]);
    await runGitCommand(['config', 'user.email', 'test@test.com'], localDir);
    await runGitCommand(['config', 'user.name', 'Test'], localDir);

    // Create initial commit on main and push
    await Bun.write(join(localDir, 'test.txt'), 'initial');
    await runGitCommand(['add', '.'], localDir);
    await runGitCommand(['commit', '-m', 'initial'], localDir);
    await runGitCommand(['push', '-u', 'origin', 'HEAD'], localDir);

    // Create feature branch with a commit
    await runGitCommand(['checkout', '-b', 'feature'], localDir);
    await Bun.write(join(localDir, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], localDir);
    await runGitCommand(['commit', '-m', 'feature'], localDir);

    // Fetch to have origin/main or origin/master available
    await fetchOrigin(localDir);

    // Get the default branch name
    const defaultBranchResult = await getDefaultBranch(localDir);
    if (!defaultBranchResult.success) {
      throw new Error('Could not get default branch');
    }

    const result = await rebaseOnBranch(localDir, defaultBranchResult.data);
    expect(result).toEqual({ success: true, data: undefined });
  });
});
