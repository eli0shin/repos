import { describe, expect, test } from 'bun:test';

// Helper to run CLI and capture output
async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', 'run', 'src/cli.ts', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: import.meta.dir.replace('/tests', ''),
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
      stdout: '0.1.0\n',
      stderr: '',
      exitCode: 0,
    });
  });

  test('-v outputs version from package.json', async () => {
    expect(await runCli(['-v'])).toEqual({
      stdout: '0.1.0\n',
      stderr: '',
      exitCode: 0,
    });
  });
});

const HELP_OUTPUT = `Usage: repos [options] [command]

Git repository manager

Options:
  -v, --version            output the version number
  -h, --help               display help for command

Commands:
  list                     List all tracked repositories
  add <url>                Clone a repo and add it to tracking
  clone [name]             Clone repos from config (all or specific)
  remove [options] <name>  Remove a repo from tracking
  latest                   Pull all repos (parallel)
  adopt                    Add existing repos to config
  sync                     Adopt existing + clone missing repos
  update                   Update repos CLI to latest version
  help [command]           display help for command
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

