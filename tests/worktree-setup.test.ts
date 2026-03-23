import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  spyOn,
  type Mock,
} from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { runGitCommand } from '../src/git/index.ts';
import { writeConfig, readConfig } from '../src/config.ts';
import { workCommand } from '../src/commands/work.ts';
import { stackCommand } from '../src/commands/stack.ts';
import type { ReposConfig } from '../src/types.ts';
import { mockProcessExit, type MockExit } from './utils.ts';
import * as tmux from '../src/tmux.ts';

async function createTestRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await runGitCommand(['init', '-b', 'main'], dir);
  await Bun.write(join(dir, 'test.txt'), 'test');
  await runGitCommand(['add', '.'], dir);
  await runGitCommand(['commit', '-m', 'initial'], dir);
}

function captureOutput(stream: 'stdout' | 'stderr'): {
  output: string[];
  restore: () => void;
} {
  const output: string[] = [];
  const originalWrite = process[stream].write.bind(process[stream]);
  process[stream].write = (chunk: string | Uint8Array) => {
    output.push(
      typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    );
    return true;
  };
  return { restore: () => (process[stream].write = originalWrite), output };
}

describe('worktree setup integration', () => {
  const testDir = '/tmp/repos-test-worktree-setup';
  const sourceDir = '/tmp/repos-test-worktree-setup-source';
  const configPath = '/tmp/repos-test-worktree-setup-config/config.json';
  let originalCwd: string;
  let mockExit: MockExit;
  let openTmuxSessionSpy: Mock<typeof tmux.openTmuxSession>;

  beforeEach(async () => {
    originalCwd = process.cwd();
    mockExit = mockProcessExit();
    openTmuxSessionSpy = spyOn(tmux, 'openTmuxSession').mockResolvedValue(
      undefined
    );
    await mkdir(testDir, { recursive: true });
    await createTestRepo(sourceDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    mockExit.mockRestore();
    openTmuxSessionSpy.mockRestore();
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm('/tmp/repos-test-worktree-setup-config', {
      recursive: true,
      force: true,
    });
  });

  async function setupRegularRepo(): Promise<{ repoDir: string }> {
    const repoDir = join(testDir, 'repo');
    await runGitCommand(['clone', sourceDir, repoDir]);
    const config = {
      repos: [{ name: 'repo', url: sourceDir, path: repoDir }],
    } satisfies ReposConfig;
    await writeConfig(configPath, config);
    return { repoDir };
  }

  test('work copies files and runs setup command in new worktree', async () => {
    const { repoDir } = await setupRegularRepo();
    await Bun.write(join(repoDir, '.env'), 'SECRET=1\n');
    await mkdir(join(repoDir, '.repos'), { recursive: true });
    await Bun.write(
      join(repoDir, '.repos', 'worktree.json'),
      JSON.stringify(
        {
          setup: {
            copy: ['.env'],
            command:
              'printf "%s\\n%s\\n%s\\n" "$1" "$2" "$PWD" > setup-result.txt',
          },
        },
        null,
        2
      )
    );

    await workCommand({ configPath }, 'feature', 'repo');

    const worktreePath = join(testDir, 'repo-feature');
    expect(await Bun.file(join(worktreePath, '.env')).text()).toBe(
      'SECRET=1\n'
    );
    expect(await Bun.file(join(worktreePath, 'setup-result.txt')).text()).toBe(
      `${realpathSync(repoDir)}\n${worktreePath}\n${realpathSync(worktreePath)}\n`
    );
  });

  test('work does not rerun setup for an existing worktree', async () => {
    const { repoDir } = await setupRegularRepo();
    await mkdir(join(repoDir, '.repos'), { recursive: true });
    await Bun.write(
      join(repoDir, '.repos', 'worktree.json'),
      JSON.stringify(
        {
          setup: {
            command: 'echo ran >> setup-count.txt',
          },
        },
        null,
        2
      )
    );

    await workCommand({ configPath }, 'feature', 'repo');
    await workCommand({ configPath }, 'feature', 'repo');

    const worktreePath = join(testDir, 'repo-feature');
    expect(await Bun.file(join(worktreePath, 'setup-count.txt')).text()).toBe(
      'ran\n'
    );
  });

  test('work setup command output stays off stdout', async () => {
    const { repoDir } = await setupRegularRepo();
    await mkdir(join(repoDir, '.repos'), { recursive: true });
    await Bun.write(
      join(repoDir, '.repos', 'worktree.json'),
      JSON.stringify(
        {
          setup: {
            command: 'echo setup-output',
          },
        },
        null,
        2
      )
    );

    const stdout = captureOutput('stdout');
    const stderr = captureOutput('stderr');

    await workCommand({ configPath }, 'feature', 'repo');

    stdout.restore();
    stderr.restore();

    expect(stdout.output.join('')).toBe(join(testDir, 'repo-feature') + '\n');
    expect(stderr.output.join('')).toContain('setup-output');
  });

  test('work with tmux keeps setup command output off stdout', async () => {
    const { repoDir } = await setupRegularRepo();
    await mkdir(join(repoDir, '.repos'), { recursive: true });
    await Bun.write(
      join(repoDir, '.repos', 'worktree.json'),
      JSON.stringify(
        {
          setup: {
            command: 'echo setup-output',
          },
        },
        null,
        2
      )
    );

    const stdout = captureOutput('stdout');
    const stderr = captureOutput('stderr');

    await workCommand({ configPath }, 'feature', 'repo', { tmux: true });

    stdout.restore();
    stderr.restore();

    expect(stdout.output).toEqual([]);
    expect(stderr.output.join('')).toContain('setup-output');
    expect(openTmuxSessionSpy).toHaveBeenCalledWith(
      'repo',
      'feature',
      join(testDir, 'repo-feature')
    );
  });

  test('work exits without stdout path when setup fails', async () => {
    const { repoDir } = await setupRegularRepo();
    await mkdir(join(repoDir, '.repos'), { recursive: true });
    await Bun.write(
      join(repoDir, '.repos', 'worktree.json'),
      JSON.stringify(
        {
          setup: {
            command: 'echo boom && exit 2',
          },
        },
        null,
        2
      )
    );

    const stdout = captureOutput('stdout');
    const stderr = captureOutput('stderr');

    await expect(
      workCommand({ configPath }, 'feature', 'repo')
    ).rejects.toThrow('process.exit(1)');

    stdout.restore();
    stderr.restore();

    expect(stdout.output).toEqual([]);
    expect(stderr.output.join('')).toContain('boom');
    expect(stderr.output.join('')).toContain('Setup failed');
    expect(stderr.output.join('')).toContain(
      'Hint: The worktree was created and left in place for manual recovery.'
    );
    expect(existsSync(join(testDir, 'repo-feature'))).toBe(true);
  });

  test('stack runs setup for the new stacked worktree', async () => {
    const { repoDir } = await setupRegularRepo();
    await mkdir(join(repoDir, '.repos'), { recursive: true });
    await Bun.write(
      join(repoDir, '.repos', 'worktree.json'),
      JSON.stringify(
        {
          setup: {
            command:
              'printf "%s\\n%s\\n%s\\n" "$1" "$2" "$PWD" > stack-setup.txt',
          },
        },
        null,
        2
      )
    );

    const parentPath = join(testDir, 'repo-parent');
    await runGitCommand(
      ['worktree', 'add', '-b', 'parent', parentPath],
      repoDir
    );
    await Bun.write(join(parentPath, 'parent.txt'), 'parent');
    await runGitCommand(['add', '.'], parentPath);
    await runGitCommand(['commit', '-m', 'parent commit'], parentPath);
    process.chdir(parentPath);

    await stackCommand({ configPath }, 'child');

    const childPath = join(testDir, 'repo-child');
    expect(await Bun.file(join(childPath, 'stack-setup.txt')).text()).toBe(
      `${realpathSync(repoDir)}\n${childPath}\n${realpathSync(childPath)}\n`
    );

    expect(await readConfig(configPath)).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'repo',
            url: sourceDir,
            path: repoDir,
            stacks: [{ parent: 'parent', child: 'child' }],
          },
        ],
      },
    });
  });

  test('stack exits with recovery hint when setup fails', async () => {
    const { repoDir } = await setupRegularRepo();
    await mkdir(join(repoDir, '.repos'), { recursive: true });
    await Bun.write(
      join(repoDir, '.repos', 'worktree.json'),
      JSON.stringify(
        {
          setup: {
            command: 'echo boom && exit 2',
          },
        },
        null,
        2
      )
    );

    const parentPath = join(testDir, 'repo-parent');
    await runGitCommand(
      ['worktree', 'add', '-b', 'parent', parentPath],
      repoDir
    );
    process.chdir(parentPath);

    const stdout = captureOutput('stdout');
    const stderr = captureOutput('stderr');

    await expect(stackCommand({ configPath }, 'child')).rejects.toThrow(
      'process.exit(1)'
    );

    stdout.restore();
    stderr.restore();

    const childPath = join(testDir, 'repo-child');
    expect(stdout.output).toEqual([]);
    expect(stderr.output.join('')).toContain('boom');
    expect(stderr.output.join('')).toContain('Setup failed');
    expect(stderr.output.join('')).toContain(
      'Hint: The worktree was created and left in place for manual recovery.'
    );
    expect(existsSync(childPath)).toBe(true);
    expect(await readConfig(configPath)).toEqual({
      success: true,
      data: {
        repos: [
          {
            name: 'repo',
            url: sourceDir,
            path: repoDir,
            stacks: [{ parent: 'parent', child: 'child' }],
          },
        ],
      },
    });
  });
});
