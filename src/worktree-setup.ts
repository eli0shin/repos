import { copyFile, mkdir, stat } from 'node:fs/promises';
import { isAbsolute, dirname, join, normalize } from 'node:path';
import { printError, printStatus } from './output.ts';
import type { OperationResult, WorktreeSetupConfig } from './types.ts';

function resolveRelativePath(rootPath: string, relativePath: string): string {
  return join(rootPath, normalize(relativePath));
}

function isSafeRelativePath(relativePath: string): boolean {
  if (isAbsolute(relativePath)) return false;
  const normalized = normalize(relativePath);
  return normalized !== '..' && !normalized.startsWith('../');
}

async function copySetupFiles(
  mainWorktreePath: string,
  worktreePath: string,
  copyPaths: string[]
): Promise<OperationResult> {
  for (const relativePath of copyPaths) {
    if (!isSafeRelativePath(relativePath)) {
      return {
        success: false,
        error: `Invalid setup copy path "${relativePath}"`,
      };
    }

    const sourcePath = resolveRelativePath(mainWorktreePath, relativePath);
    const destinationPath = resolveRelativePath(worktreePath, relativePath);

    let sourceStat: Awaited<ReturnType<typeof stat>>;
    try {
      sourceStat = await stat(sourcePath);
    } catch {
      return {
        success: false,
        error: `Setup copy source not found: ${relativePath}`,
      };
    }

    if (!sourceStat.isFile()) {
      return {
        success: false,
        error: `Setup copy source must be a file: ${relativePath}`,
      };
    }

    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
    printStatus(`Copied setup file "${relativePath}"`);
  }

  return { success: true, data: undefined };
}

async function runSetupCommand(
  mainWorktreePath: string,
  worktreePath: string,
  command: string
): Promise<OperationResult> {
  printStatus('Running worktree setup command...');

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
    return {
      success: false,
      error: `Setup command failed with exit code ${exitCode}`,
    };
  }

  return { success: true, data: undefined };
}

export async function runWorktreeSetup(
  mainWorktreePath: string,
  worktreePath: string,
  setup?: WorktreeSetupConfig
): Promise<OperationResult> {
  if (!setup) {
    return { success: true, data: undefined };
  }

  if (setup.copy && setup.copy.length > 0) {
    const copyResult = await copySetupFiles(
      mainWorktreePath,
      worktreePath,
      setup.copy
    );
    if (!copyResult.success) {
      return copyResult;
    }
  }

  if (setup.command) {
    const commandResult = await runSetupCommand(
      mainWorktreePath,
      worktreePath,
      setup.command
    );
    if (!commandResult.success) {
      return commandResult;
    }
  }

  return { success: true, data: undefined };
}

export function printSetupError(error: string, worktreePath: string): void {
  printError(`Error: Setup failed for worktree at ${worktreePath}: ${error}`);
}
