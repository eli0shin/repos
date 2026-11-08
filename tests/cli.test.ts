import {
  afterAll,
  beforeAll,
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { version } from '../package.json';
import { cloneBare, cloneRepo, runGitCommand } from '../src/git/index.ts';
import { writeConfig } from '../src/config.ts';
import type { ReposConfig } from '../src/types.ts';
import { createFakeHerdr } from './fake-herdr.ts';
import { createTestRepo as createSeedRepo, tmpRoot } from './helpers.ts';

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
  rebase [options] [branch] [repo-name]  Update the default branch from origin or rebase a branch and its children on their parents
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
  -t, --tmux           Open the Managed Workspace for the worktree (default:
                       false)
  --no-tmux            Disable the Workspace Manager, even inside a managed
                       environment
  --no-focus           Create or reuse a Managed Workspace without focusing
  -i, --index <index>  Use a worktree index from repos list
  -h, --help           display help for command
`;

const STACK_HELP_OUTPUT = `Usage: repos stack [options] <branch>

Create a stacked worktree from current branch

Arguments:
  branch      New branch name

Options:
  -t, --tmux  Open the Managed Workspace for the worktree (default: false)
  --no-tmux   Disable the Workspace Manager, even inside a managed environment
  --no-focus  Create or reuse a Managed Workspace without focusing
  -h, --help  display help for command
`;

const CLEAN_HELP_OUTPUT = `Usage: repos clean [options] [branch] [repo-name]

Remove a worktree

Arguments:
  branch               Branch name (optional if inside a worktree)
  repo-name            Repo name (optional if inside a tracked repo)

Options:
  --force              Force removal with uncommitted changes or stacked
                       children
  --dry-run            Show what would be removed without removing
  -i, --index <index>  Use a worktree index from repos list
  -t, --tmux           Close the Managed Workspace and focus the main worktree
                       (default: false)
  --no-tmux            Disable the Workspace Manager, even inside a managed
                       environment
  --no-focus           Close the Managed Workspace without changing focus
  -h, --help           display help for command
`;

const REBASE_HELP_OUTPUT = `Usage: repos rebase [options] [branch] [repo-name]

Update the default branch from origin or rebase a branch and its children on
their parents

Arguments:
  branch               Branch name to update or rebase (optional if inside a
                       worktree)
  repo-name            Repo name (optional if inside a tracked repo)

Options:
  -i, --index <index>  Use a worktree index from repos list
  --only               Only update or rebase the selected branch, skip children
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

  test('rebase help documents default updates and parent-based rebases', async () => {
    expect(await runCli(['rebase', '--help'])).toEqual({
      stdout: REBASE_HELP_OUTPUT,
      stderr: '',
      exitCode: 0,
    });
  });

  test('work, stack, and clean help document --no-focus', async () => {
    expect(
      await Promise.all(
        ['work', 'stack', 'clean'].map((command) => runCli([command, '--help']))
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
      await Promise.all(invocations.map((args) => runCli(args, {})))
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
  const testDir = join(tmpRoot, 'repos-test-cli-clean-index');
  const sourceDir = join(tmpRoot, 'repos-test-cli-clean-index-source');
  const configHome = join(tmpRoot, 'repos-test-cli-clean-index-config');

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
      })
    ).toEqual({
      stdout: '',
      stderr: 'Would remove worktree "cli-clean-index-feature"\n',
      exitCode: 0,
    });
  });
});

describe.serial('CLI Workspace Manager defaults', () => {
  const testDir = join(tmpRoot, `repos-test-cli-defaults-${process.pid}`);
  const fakeDir = join(testDir, 'bin');
  const seedPath = join(testDir, 'seed');
  const remotePath = join(testDir, 'remote.git');
  const repoPath = join(testDir, 'repo');
  const featurePath = join(testDir, 'repo-feature');
  const configHome = join(testDir, 'config');
  let herdr: Record<string, string>;

  function env(
    overrides: Record<string, string | undefined> = {}
  ): Record<string, string | undefined> {
    return {
      XDG_CONFIG_HOME: configHome,
      PATH: `${fakeDir}:${process.env.PATH}`,
      ...herdr,
      HERDR_ENV: undefined,
      HERDR_BIN_PATH: undefined,
      HERDR_SOCKET_PATH: undefined,
      HERDR_SESSION: undefined,
      HERDR_WORKSPACE_ID: undefined,
      HC_TERMINAL_ID: undefined,
      ...overrides,
    };
  }

  const insideHerdr = (): Record<string, string> => ({
    HERDR_ENV: '1',
    HERDR_BIN_PATH: join(fakeDir, 'herdr'),
    HERDR_SOCKET_PATH: join(testDir, 'herdr.sock'),
    HERDR_SESSION: `repos-cli-defaults-${process.pid}`,
  });

  beforeAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    await createSeedRepo(seedPath);
    await runGitCommand(['branch', '-M', 'main'], seedPath);
    await runGitCommand(['init', '--bare', remotePath], testDir);
    await runGitCommand(
      ['symbolic-ref', 'HEAD', 'refs/heads/main'],
      remotePath
    );
    await runGitCommand(['remote', 'add', 'origin', remotePath], seedPath);
    await runGitCommand(['push', '-u', 'origin', 'main'], seedPath);
    const cloned = await cloneRepo(remotePath, repoPath);
    if (!cloned.success) throw new Error(cloned.error);
    // No workspaceManager: Herdr is the default.
    await writeConfig(join(configHome, 'repos', 'config.json'), {
      repos: [{ name: 'repo', url: remotePath, path: repoPath }],
      config: { updateBehavior: 'off' },
    });
    const fake = await createFakeHerdr(fakeDir);
    herdr = {
      FAKE_HERDR_STATE: fake.statePath,
      FAKE_HERDR_SERVER_SOCKET: fake.serverSocketPath,
      FAKE_HERDR_SERVER_READY: fake.serverReadyPath,
    };
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('work opens a Herdr workspace when no Workspace Manager is configured', async () => {
    expect(
      await runCli(['work', '--no-focus', 'feature', 'repo'], env())
    ).toEqual({
      stdout: `${featurePath}\n`,
      stderr:
        'Creating worktree for "feature"...\nCreated worktree "repo-feature"\nOpened Herdr workspace "repo@feature"\n',
      exitCode: 0,
    });
  });

  test('cleanup closes Herdr workspaces only with --tmux or inside Herdr, and ignores tmux', async () => {
    await runGitCommand(['push', '-u', 'origin', 'feature'], featurePath);
    await runGitCommand(['push', 'origin', '--delete', 'feature'], repoPath);
    const removal =
      'Would remove repo/feature (upstream deleted)\n\nWould remove 1 worktree(s) (1 upstream deleted)\n';
    const closure = 'Would close Herdr workspace "repo@feature"\n';
    const preview = async (
      args: string[],
      overrides: Record<string, string> = {}
    ): Promise<string> =>
      (await runCli(['cleanup', '--dry-run', ...args], env(overrides))).stdout;

    expect([
      await preview([]),
      await preview(['--tmux']),
      await preview([], insideHerdr()),
      await preview(['--no-tmux'], insideHerdr()),
      await preview([], { TMUX: '/tmp/tmux-1000/default,1,0' }),
    ]).toEqual([
      removal,
      removal + closure,
      removal + closure,
      removal,
      removal,
    ]);
  });
});
