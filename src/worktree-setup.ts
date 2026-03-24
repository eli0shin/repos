import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { printError, printStatus } from './output.ts';
import type { WorktreeSetupConfig, WorktreeSetupReport } from './types.ts';

function resolveRelativePath(rootPath: string, relativePath: string): string {
  return join(rootPath, normalize(relativePath));
}

async function copySetupPath(
  sourcePath: string,
  destinationPath: string
): Promise<void> {
  const sourceStat = await stat(sourcePath);

  if (sourceStat.isDirectory()) {
    await mkdir(destinationPath, { recursive: true });
    const entries = await readdir(sourcePath, { withFileTypes: true });

    for (const entry of entries) {
      await copySetupPath(
        join(sourcePath, entry.name),
        join(destinationPath, entry.name)
      );
    }

    return;
  }

  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
}

async function copySetupFiles(
  mainWorktreePath: string,
  worktreePath: string,
  copyPaths: string[]
): Promise<string[]> {
  const warnings: string[] = [];

  for (const relativePath of copyPaths) {
    const sourcePath = resolveRelativePath(mainWorktreePath, relativePath);
    const destinationPath = resolveRelativePath(worktreePath, relativePath);

    try {
      await copySetupPath(sourcePath, destinationPath);
      printStatus(`Copied setup path "${relativePath}"`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown setup copy error';
      warnings.push(
        `Warning: Failed to copy setup path "${relativePath}": ${message}`
      );
    }
  }

  return warnings;
}

async function runSetupCommand(
  mainWorktreePath: string,
  worktreePath: string,
  command: string
): Promise<string[]> {
  printStatus('Running worktree setup command...');
  const warnings: string[] = [];

  const proc = Bun.spawn(
    [
      '/bin/sh',
      '-lc',
      command,
      'repos-worktree-setup',
      mainWorktreePath,
      worktreePath,
    ],
    {
      cwd: worktreePath,
      env: {
        ...process.env,
        REPOS_MAIN_WORKTREE: mainWorktreePath,
        REPOS_WORKTREE: worktreePath,
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  if (stdout) {
    process.stderr.write(stdout);
    if (!stdout.endsWith('\n')) {
      process.stderr.write('\n');
    }
  }
  if (stderr) {
    process.stderr.write(stderr);
    if (!stderr.endsWith('\n')) {
      process.stderr.write('\n');
    }
  }

  if (exitCode !== 0) {
    warnings.push(`Warning: Setup command failed with exit code ${exitCode}`);
  }

  return warnings;
}

export async function runWorktreeSetup(
  mainWorktreePath: string,
  worktreePath: string,
  setup?: WorktreeSetupConfig
): Promise<WorktreeSetupReport> {
  const warnings: string[] = [];

  if (!setup) {
    return { warnings };
  }

  try {
    if (setup.copy && setup.copy.length > 0) {
      warnings.push(
        ...(await copySetupFiles(mainWorktreePath, worktreePath, setup.copy))
      );
    }

    if (setup.command) {
      warnings.push(
        ...(await runSetupCommand(
          mainWorktreePath,
          worktreePath,
          setup.command
        ))
      );
    }

    return { warnings };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown setup error';
    warnings.push(
      `Warning: Worktree setup encountered an unexpected error: ${message}`
    );

    return { warnings };
  }
}

export function printSetupWarnings(warnings: string[]): void {
  for (const warning of warnings) {
    printError(warning);
  }
}
