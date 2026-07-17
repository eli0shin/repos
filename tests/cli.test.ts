import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { version } from '../package.json';
import { cloneBare, runGitCommand } from '../src/git/index.ts';
import {
  tmuxHasSession,
  tmuxKillSession,
  tmuxNewSession,
} from '../src/tmux.ts';
import { writeConfig } from '../src/config.ts';
import type { ReposConfig } from '../src/types.ts';

// Helper to run CLI and capture output
async function runCli(
  args: string[],
  env: Record<string, string | undefined> = {},
  cwd = import.meta.dir.replace('/tests', '')
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const processEnv = Object.fromEntries(
    Object.entries({ ...process.env, ...env }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );

  const cliPath = join(import.meta.dir.replace('/tests', ''), 'src/cli.ts');
  const proc = Bun.spawn(['bun', 'run', cliPath, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd,
    env: processEnv,
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

describe('CLI version flag', () => {
  test('--version outputs version from package.json', async () => {
    expect(await runCli(['--version'])).toEqual({
      stdout: `${version}\n`,
      stderr: '',
      exitCode: 0,
    });
  });

  test('-v outputs version from package.json', async () => {
    expect(await runCli(['-v'])).toEqual({
      stdout: `${version}\n`,
      stderr: '',
      exitCode: 0,
    });
  });
});

const HELP_OUTPUT = `Usage: repos [options] [command]

Git repository manager

Options:
  -v, --version                          output the version number
  -h, --help                             display help for command

Commands:
  list                                   List all tracked repositories
  add [options] <url>                    Clone a repo and add it to tracking
  clone [name]                           Clone repos from config (all or specific)
  remove [options] <name>                Remove a repo from tracking
  latest                                 Pull all repos (parallel)
  adopt                                  Add existing repos to config
  sync                                   Adopt existing + clone missing repos
  update                                 Update repos CLI to latest version
  work [options] [branch] [repo-name]    Create a worktree for a branch
  stack [options] <branch>               Create a stacked worktree from current branch
  restack [options]                      Deprecated alias for rebase
  unstack                                Rebase current branch on default branch and remove stack relationship
  continue                               Continue a paused rebase and update fork point tracking
  squash [options]                       Squash commits since base branch into a single commit
  clean [options] [branch] [repo-name]   Remove a worktree
  main [repo-name]                       Output main worktree path (for shell wrapper to cd)
  rebase [options] [branch] [repo-name]  Rebase a branch and its children on their parents
  cleanup [options]                      Remove worktrees for merged or deleted branches
  init [options]                         Configure shell for work command
  help [command]                         display help for command
`;

const WORK_HELP_OUTPUT = `Usage: repos work [options] [branch] [repo-name]

Create a worktree for a branch

Arguments:
  branch               Branch name for the worktree
  repo-name            Repo name (optional if inside a tracked repo)

Options:
  -t, --tmux           Open a tmux session in the worktree (default: false)
  --no-tmux            Do not use tmux, even inside a tmux session
  --no-focus           Create or reuse tmux session without attaching or
                       switching
  -i, --index <index>  Use a worktree index from repos list
  -h, --help           display help for command
`;

const STACK_HELP_OUTPUT = `Usage: repos stack [options] <branch>

Create a stacked worktree from current branch

Arguments:
  branch      New branch name

Options:
  -t, --tmux  Open a tmux session in the worktree (default: false)
  --no-tmux   Do not use tmux, even inside a tmux session
  --no-focus  Create or reuse tmux session without attaching or switching
  -h, --help  display help for command
`;

const CLEAN_HELP_OUTPUT = `Usage: repos clean [options] [branch] [repo-name]

Remove a worktree

Arguments:
  branch               Branch name (optional if inside a worktree)
  repo-name            Repo name (optional if inside a tracked repo)

Options:
  --force              Force removal even if branch has stacked children
  --dry-run            Show what would be removed without removing
  -i, --index <index>  Use a worktree index from repos list
  -t, --tmux           Kill the worktree tmux session and switch to the main
                       worktree session (default: false)
  --no-tmux            Do not use tmux, even inside a tmux session
  --no-focus           Kill tmux session without attaching or switching
  -h, --help           display help for command
`;

const REMOVE_HELP_OUTPUT = `Usage: repos remove [options] <name>

Remove a repo from tracking

Arguments:
  name          Repo name to remove

Options:
  -d, --delete  Also delete the directory
  -h, --help    display help for command
`;

describe('CLI help output', () => {
  test('--help displays help with all commands', async () => {
    expect(await runCli(['--help'])).toEqual({
      stdout: HELP_OUTPUT,
      stderr: '',
      exitCode: 0,
    });
  });

  test('-h displays help', async () => {
    expect(await runCli(['-h'])).toEqual({
      stdout: HELP_OUTPUT,
      stderr: '',
      exitCode: 0,
    });
  });

  test('work, stack, and clean help document --no-focus', async () => {
    expect(
      await Promise.all(
        ['work', 'stack', 'clean'].map((command) =>
          runCli([command, '--help'], { TMUX: undefined })
        )
      )
    ).toEqual([
      { stdout: WORK_HELP_OUTPUT, stderr: '', exitCode: 0 },
      { stdout: STACK_HELP_OUTPUT, stderr: '', exitCode: 0 },
      { stdout: CLEAN_HELP_OUTPUT, stderr: '', exitCode: 0 },
    ]);
  });

  test('remove --help shows -d and --delete options', async () => {
    expect(await runCli(['remove', '--help'])).toEqual({
      stdout: REMOVE_HELP_OUTPUT,
      stderr: '',
      exitCode: 0,
    });
  });
});

describe('removed CLI commands', () => {
  test('collapse is no longer available', async () => {
    expect(await runCli(['collapse'])).toEqual({
      stdout: '',
      stderr: "error: unknown command 'collapse'\n",
      exitCode: 1,
    });
  });
});

describe('CLI add command', () => {
  test('errors when url argument is missing', async () => {
    expect(await runCli(['add'])).toEqual({
      stdout: '',
      stderr: "error: missing required argument 'url'\n",
      exitCode: 1,
    });
  });
});

describe('CLI remove command', () => {
  test('errors when name argument is missing', async () => {
    expect(await runCli(['remove'])).toEqual({
      stdout: '',
      stderr: "error: missing required argument 'name'\n",
      exitCode: 1,
    });
  });
});

describe('CLI work command', () => {
  test('work, stack, and clean reject --no-focus with --no-tmux', async () => {
    const error = {
      stdout: '',
      stderr: 'Error: --no-focus cannot be combined with --no-tmux\n',
      exitCode: 1,
    };
    const commands = ['work', 'stack', 'clean'];
    const invocations = commands.flatMap((command) => [
      [command, '--no-focus', '--no-tmux', 'feature'],
      [command, '--no-focus', '--no-tmux', '--tmux', 'feature'],
      [command, '--no-tmux', '--tmux', '--no-focus', 'feature'],
    ]);
    expect(
      await Promise.all(
        invocations.map((args) => runCli(args, { TMUX: undefined }))
      )
    ).toEqual(invocations.map(() => error));
  });

  test('errors when index option value is missing', async () => {
    expect(await runCli(['work', '--index'])).toEqual({
      stdout: '',
      stderr: "error: option '-i, --index <index>' argument missing\n",
      exitCode: 1,
    });
  });

  test('errors when index option is not numeric', async () => {
    expect(await runCli(['work', '--index', 'abc'])).toEqual({
      stdout: '',
      stderr:
        "error: option '-i, --index <index>' argument 'abc' is invalid. index must be a positive integer\n",
      exitCode: 1,
    });
  });
});

describe('CLI index options', () => {
  const testDir = '/tmp/repos-test-cli-clean-index';
  const sourceDir = '/tmp/repos-test-cli-clean-index-source';
  const configHome = '/tmp/repos-test-cli-clean-index-config';

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm(configHome, { recursive: true, force: true });
  });

  async function createTestRepo(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await runGitCommand(['init', '-b', 'main'], dir);
    await Bun.write(join(dir, 'test.txt'), 'test');
    await runGitCommand(['add', '.'], dir);
    await runGitCommand(['commit', '-m', 'initial'], dir);
  }

  async function setupIndexedRepo(): Promise<string> {
    await mkdir(testDir, { recursive: true });
    await mkdir(join(configHome, 'repos'), { recursive: true });
    await createTestRepo(sourceDir);

    const repoName = 'cli-clean-index';
    const bareDir = join(testDir, `${repoName}.git`);
    const worktreePath = join(testDir, `${repoName}.git-feature`);
    await cloneBare(sourceDir, bareDir);
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );

    const config = {
      repos: [
        {
          name: repoName,
          url: sourceDir,
          path: bareDir,
          bare: true,
        },
      ],
    } satisfies ReposConfig;
    await writeConfig(join(configHome, 'repos', 'config.json'), config);

    return worktreePath;
  }

  test('uses positional argument as repo name when work uses index', async () => {
    const worktreePath = await setupIndexedRepo();

    expect(
      await runCli(['work', '--no-tmux', '-i', '1', 'cli-clean-index'], {
        XDG_CONFIG_HOME: configHome,
        TMUX: undefined,
      })
    ).toEqual({
      stdout: `${worktreePath}\n`,
      stderr: '',
      exitCode: 0,
    });
  });

  test('uses positional argument as repo name when clean uses index', async () => {
    await setupIndexedRepo();

    expect(
      await runCli(['clean', '--dry-run', '-i', '1', 'cli-clean-index'], {
        XDG_CONFIG_HOME: configHome,
        TMUX: undefined,
      })
    ).toEqual({
      stdout: '',
      stderr: 'Would remove worktree "cli-clean-index-feature"\n',
      exitCode: 0,
    });
  });
});

describe('CLI --no-focus workflow', () => {
  const testDir = '/tmp/repos-test-cli-no-focus';
  const sourceDir = '/tmp/repos-test-cli-no-focus-source';
  const configHome = '/tmp/repos-test-cli-no-focus-config';
  const repoName = 'cli-no-focus';
  const parentSession = `${repoName}@parent`;
  const childSession = `${repoName}@child`;

  afterEach(async () => {
    await tmuxKillSession(parentSession);
    await tmuxKillSession(childSession);
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm(configHome, { recursive: true, force: true });
  });

  test('work, stack, and clean manage sessions outside tmux without focusing and print paths', async () => {
    await mkdir(sourceDir, { recursive: true });
    await runGitCommand(['init', '-b', 'main'], sourceDir);
    await Bun.write(join(sourceDir, 'test.txt'), 'test');
    await runGitCommand(['add', '.'], sourceDir);
    await runGitCommand(['commit', '-m', 'initial'], sourceDir);

    const bareDir = join(testDir, `${repoName}.git`);
    await mkdir(testDir, { recursive: true });
    await cloneBare(sourceDir, bareDir);
    await writeConfig(join(configHome, 'repos', 'config.json'), {
      repos: [{ name: repoName, url: sourceDir, path: bareDir, bare: true }],
    });
    const env = { XDG_CONFIG_HOME: configHome, TMUX: undefined };
    const parentPath = join(testDir, `${repoName}.git-parent`);
    const childPath = join(testDir, `${repoName}.git-child`);

    expect(
      await runCli(['work', '--no-focus', 'parent', repoName], env)
    ).toEqual({
      stdout: `${parentPath}\n`,
      stderr: `Creating worktree for "parent"...\nCreated worktree "${repoName}-parent"\nCreated tmux session "${parentSession}"\n`,
      exitCode: 0,
    });
    expect(await tmuxHasSession(parentSession)).toEqual({
      success: true,
      data: true,
    });

    expect(
      await runCli(['work', '--no-focus', 'parent', repoName], env)
    ).toEqual({
      stdout: `${parentPath}\n`,
      stderr: '',
      exitCode: 0,
    });

    expect(
      await runCli(['stack', '--no-focus', 'child'], env, parentPath)
    ).toEqual({
      stdout: `${childPath}\n`,
      stderr: `Creating stacked branch "child" from "parent"...\nCreated stacked worktree "${repoName}-child"\nCreated tmux session "${childSession}"\n`,
      exitCode: 0,
    });
    expect(await tmuxHasSession(childSession)).toEqual({
      success: true,
      data: true,
    });

    expect(
      await runCli(['clean', '--no-focus', 'child', repoName], env, childPath)
    ).toEqual({
      stdout: `${parentPath}\n`,
      stderr: `Removing worktree for "child"...\nRemoved worktree "${repoName}-child"\n`,
      exitCode: 0,
    });
    expect(await tmuxHasSession(childSession)).toEqual({
      success: true,
      data: false,
    });
  });
});

describe('CLI tmux defaults', () => {
  const testDir = '/tmp/repos-test-cli-tmux-default';
  const sourceDir = '/tmp/repos-test-cli-tmux-default-source';
  const configHome = '/tmp/repos-test-cli-tmux-default-config';
  const sessionNames: string[] = [];

  afterEach(async () => {
    await cleanup();
  });

  async function createTestRepo(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await runGitCommand(['init', '-b', 'main'], dir);
    await Bun.write(join(dir, 'test.txt'), 'test');
    await runGitCommand(['add', '.'], dir);
    await runGitCommand(['commit', '-m', 'initial'], dir);
  }

  async function setupStaleWorktree(): Promise<string> {
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm(configHome, { recursive: true, force: true });
    await mkdir(testDir, { recursive: true });
    await mkdir(join(configHome, 'repos'), { recursive: true });
    await createTestRepo(sourceDir);

    const repoName = 'cli-tmux-default';
    const bareDir = join(testDir, `${repoName}.git`);
    const worktreePath = join(testDir, `${repoName}.git-feature`);
    await cloneBare(sourceDir, bareDir);
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature', worktreePath],
      bareDir
    );
    await Bun.write(join(worktreePath, 'feature.txt'), 'feature');
    await runGitCommand(['add', '.'], worktreePath);
    await runGitCommand(['commit', '-m', 'feature work'], worktreePath);
    await runGitCommand(['push', '-u', 'origin', 'feature'], worktreePath);
    await runGitCommand(['branch', '-D', 'feature'], sourceDir);

    await Bun.write(
      join(configHome, 'repos', 'config.json'),
      JSON.stringify(
        {
          repos: [
            { name: repoName, url: sourceDir, path: bareDir, bare: true },
          ],
          config: { updateBehavior: 'off' },
        },
        null,
        2
      )
    );

    const sessionName = `${repoName}@feature`;
    await tmuxKillSession(sessionName);
    sessionNames.push(sessionName);
    const sessionResult = await tmuxNewSession(sessionName, worktreePath);
    expect(sessionResult).toEqual({ success: true, data: undefined });
    return sessionName;
  }

  async function cleanup(): Promise<void> {
    for (const sessionName of sessionNames.splice(0)) {
      await tmuxKillSession(sessionName);
    }
    await rm(testDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
    await rm(configHome, { recursive: true, force: true });
  }

  async function getTmuxEnv(sessionName: string): Promise<string> {
    const proc = Bun.spawn(
      [
        'tmux',
        'display-message',
        '-p',
        '-t',
        sessionName,
        '#{socket_path},#{pid},0',
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    );
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    expect(stderr).toEqual('');
    expect(exitCode).toEqual(0);
    return stdout.trim();
  }

  test('does not use tmux by default outside tmux', async () => {
    await setupStaleWorktree();
    expect(
      await runCli(['cleanup', '--dry-run'], {
        XDG_CONFIG_HOME: configHome,
        TMUX: undefined,
      })
    ).toEqual({
      stdout:
        'Would remove cli-tmux-default/feature (upstream deleted)\n\nWould remove 1 worktree(s) (1 upstream deleted)\n',
      stderr: '',
      exitCode: 0,
    });
  });

  test('--tmux uses tmux outside tmux', async () => {
    await setupStaleWorktree();
    expect(
      await runCli(['cleanup', '--dry-run', '--tmux'], {
        XDG_CONFIG_HOME: configHome,
        TMUX: undefined,
      })
    ).toEqual({
      stdout:
        'Would remove cli-tmux-default/feature (upstream deleted)\n\nWould remove 1 worktree(s) (1 upstream deleted)\nWould kill tmux session "cli-tmux-default@feature"\n',
      stderr: '',
      exitCode: 0,
    });
  });

  test('uses tmux by default inside tmux', async () => {
    const sessionName = await setupStaleWorktree();
    const tmuxEnv = await getTmuxEnv(sessionName);
    expect(
      await runCli(['cleanup', '--dry-run'], {
        XDG_CONFIG_HOME: configHome,
        TMUX: tmuxEnv,
      })
    ).toEqual({
      stdout:
        'Would remove cli-tmux-default/feature (upstream deleted)\n\nWould remove 1 worktree(s) (1 upstream deleted)\nWould kill tmux session "cli-tmux-default@feature"\n',
      stderr: '',
      exitCode: 0,
    });
  });

  test('--no-tmux opts out inside tmux', async () => {
    const sessionName = await setupStaleWorktree();
    const tmuxEnv = await getTmuxEnv(sessionName);
    expect(
      await runCli(['cleanup', '--dry-run', '--no-tmux'], {
        XDG_CONFIG_HOME: configHome,
        TMUX: tmuxEnv,
      })
    ).toEqual({
      stdout:
        'Would remove cli-tmux-default/feature (upstream deleted)\n\nWould remove 1 worktree(s) (1 upstream deleted)\n',
      stderr: '',
      exitCode: 0,
    });
  });
});
