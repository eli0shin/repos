import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { version } from '../package.json';
import { cloneBare, runGitCommand } from '../src/git/index.ts';
import { tmuxKillSession, tmuxNewSession } from '../src/tmux.ts';

// Helper to run CLI and capture output
async function runCli(
  args: string[],
  env: Record<string, string | undefined> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const processEnv = Object.fromEntries(
    Object.entries({ ...process.env, ...env }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );

  const proc = Bun.spawn(['bun', 'run', 'src/cli.ts', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: import.meta.dir.replace('/tests', ''),
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
  -v, --version                         output the version number
  -h, --help                            display help for command

Commands:
  list                                  List all tracked repositories
  add [options] <url>                   Clone a repo and add it to tracking
  clone [name]                          Clone repos from config (all or
                                        specific)
  remove [options] <name>               Remove a repo from tracking
  latest                                Pull all repos (parallel)
  adopt                                 Add existing repos to config
  sync                                  Adopt existing + clone missing repos
  update                                Update repos CLI to latest version
  work [options] [branch] [repo-name]   Create a worktree for a branch
  stack [options] <branch>              Create a stacked worktree from current
                                        branch
  restack [options]                     Rebase current branch and children on
                                        parent branch
  unstack                               Rebase current branch on default branch
                                        and remove stack relationship
  continue                              Continue a paused rebase and update fork
                                        point tracking
  collapse                              Collapse parent branch into current
                                        stacked branch
  squash [options]                      Squash commits since base branch into a
                                        single commit
  clean [options] [branch] [repo-name]  Remove a worktree
  main [repo-name]                      Output main worktree path (for shell
                                        wrapper to cd)
  rebase [branch] [repo-name]           Rebase a worktree branch on the default
                                        branch
  cleanup [options]                     Remove worktrees for merged or deleted
                                        branches
  init [options]                        Configure shell for work command
  help [command]                        display help for command
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

  test('remove --help shows -d and --delete options', async () => {
    expect(await runCli(['remove', '--help'])).toEqual({
      stdout: REMOVE_HELP_OUTPUT,
      stderr: '',
      exitCode: 0,
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
