import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { runGitCommand, cloneBare } from '../src/git.ts';
import { listCommand } from '../src/commands/list.ts';
import { writeConfig } from '../src/config.ts';
import type { ReposConfig } from '../src/types.ts';

// Helper to create a test repo with commits
async function createTestRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await runGitCommand(['init'], dir);
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
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir1);
    await createTestRepo(sourceDir2);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
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
    process.chdir(wt1Path);
    const capture = captureOutput();
    await listCommand({ configPath });
    capture.restore();

    const output = capture.output.join('');
    const realWt1Path = await realpath(wt1Path);
    const expectedOutput = [
      `  repo1 (bare) ✓`,
      `    ${bareDir1}`,
      `      └─ feature: ${realWt1Path}`,
      '',
    ].join('\n');
    expect(output).toEqual(expectedOutput);
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
    process.chdir('/tmp');
    const capture = captureOutput();
    await listCommand({ configPath });
    capture.restore();

    const output = capture.output.join('');
    const expectedOutput = [
      'Tracked repositories:',
      '',
      `  repo1 (bare) ✓`,
      `    ${bareDir1}`,
      `  repo2 (bare) ✓`,
      `    ${bareDir2}`,
      '',
    ].join('\n');
    expect(output).toEqual(expectedOutput);
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
    process.chdir(parentPath);
    const capture = captureOutput();
    await listCommand({ configPath });
    capture.restore();

    const output = capture.output.join('');
    const realParentPath = await realpath(parentPath);
    const realChildPath = await realpath(childPath);
    const expectedOutput = [
      `  repo (bare) ✓`,
      `    ${bareDir}`,
      `      └─ parent: ${realParentPath}`,
      `         └─ child: ${realChildPath} (stacked)`,
      '',
    ].join('\n');
    expect(output).toEqual(expectedOutput);
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
    process.chdir(bareDir1);
    const capture = captureOutput();
    await listCommand({ configPath });
    capture.restore();

    const output = capture.output.join('');
    const realWt1Path = await realpath(wt1Path);
    const expectedOutput = [
      `  repo1 (bare) ✓`,
      `    ${bareDir1}`,
      `      └─ feature: ${realWt1Path}`,
      '',
    ].join('\n');
    expect(output).toEqual(expectedOutput);
  });

  test('shows complex multi-level stack relationships', async () => {
    // Setup: Create bare repo with multiple stacked worktrees
    // Stack relationships: b > a > main, d > c > main, e > main
    const bareDir = join(testDir, 'bare.git');
    await cloneBare(sourceDir1, bareDir);

    // Create worktrees
    const aPath = join(testDir, 'bare.git-a');
    const bPath = join(testDir, 'bare.git-b');
    const cPath = join(testDir, 'bare.git-c');
    const dPath = join(testDir, 'bare.git-d');
    const ePath = join(testDir, 'bare.git-e');

    await runGitCommand(['worktree', 'add', '-b', 'a', aPath], bareDir);
    await runGitCommand(['worktree', 'add', '-b', 'b', bPath], bareDir);
    await runGitCommand(['worktree', 'add', '-b', 'c', cPath], bareDir);
    await runGitCommand(['worktree', 'add', '-b', 'd', dPath], bareDir);
    await runGitCommand(['worktree', 'add', '-b', 'e', ePath], bareDir);

    // Create config with stack relationships
    const config = {
      repos: [
        {
          name: 'repo',
          url: sourceDir1,
          path: bareDir,
          bare: true,
          stacks: [
            { parent: 'main', child: 'a' },
            { parent: 'a', child: 'b' },
            { parent: 'main', child: 'c' },
            { parent: 'c', child: 'd' },
            { parent: 'main', child: 'e' },
          ],
        },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run from inside the repo
    process.chdir(aPath);
    const capture = captureOutput();
    await listCommand({ configPath });
    capture.restore();

    const output = capture.output.join('');
    const realAPath = await realpath(aPath);
    const realBPath = await realpath(bPath);
    const realCPath = await realpath(cPath);
    const realDPath = await realpath(dPath);
    const realEPath = await realpath(ePath);
    const expectedOutput = [
      `  repo (bare) ✓`,
      `    ${bareDir}`,
      `      ├─ a: ${realAPath} (stacked)`,
      `      │  └─ b: ${realBPath} (stacked)`,
      `      ├─ c: ${realCPath} (stacked)`,
      `      │  └─ d: ${realDPath} (stacked)`,
      `      └─ e: ${realEPath} (stacked)`,
      '',
    ].join('\n');
    expect(output).toEqual(expectedOutput);
  });

  test('shows complex multi-level stack relationships for non-bare repo', async () => {
    // Setup: Create regular repo with multiple stacked worktrees
    // Stack relationships: b > a > main, d > c > main, e > main
    const repoDir = join(testDir, 'repo');
    await mkdir(repoDir, { recursive: true });
    await runGitCommand(['clone', sourceDir1, repoDir], testDir);

    // Create worktrees
    const aPath = join(testDir, 'repo-a');
    const bPath = join(testDir, 'repo-b');
    const cPath = join(testDir, 'repo-c');
    const dPath = join(testDir, 'repo-d');
    const ePath = join(testDir, 'repo-e');

    await runGitCommand(['worktree', 'add', '-b', 'a', aPath], repoDir);
    await runGitCommand(['worktree', 'add', '-b', 'b', bPath], repoDir);
    await runGitCommand(['worktree', 'add', '-b', 'c', cPath], repoDir);
    await runGitCommand(['worktree', 'add', '-b', 'd', dPath], repoDir);
    await runGitCommand(['worktree', 'add', '-b', 'e', ePath], repoDir);

    // Create config with stack relationships
    const config = {
      repos: [
        {
          name: 'repo',
          url: sourceDir1,
          path: repoDir,
          stacks: [
            { parent: 'main', child: 'a' },
            { parent: 'a', child: 'b' },
            { parent: 'main', child: 'c' },
            { parent: 'c', child: 'd' },
            { parent: 'main', child: 'e' },
          ],
        },
      ],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);

    // Run from inside the repo
    process.chdir(aPath);
    const capture = captureOutput();
    await listCommand({ configPath });
    capture.restore();

    const output = capture.output.join('');
    const realAPath = await realpath(aPath);
    const realBPath = await realpath(bPath);
    const realCPath = await realpath(cPath);
    const realDPath = await realpath(dPath);
    const realEPath = await realpath(ePath);
    const expectedOutput = [
      `  repo ✓`,
      `    ${repoDir}`,
      `      ├─ a: ${realAPath} (stacked)`,
      `      │  └─ b: ${realBPath} (stacked)`,
      `      ├─ c: ${realCPath} (stacked)`,
      `      │  └─ d: ${realDPath} (stacked)`,
      `      └─ e: ${realEPath} (stacked)`,
      '',
    ].join('\n');
    expect(output).toEqual(expectedOutput);
  });
});
