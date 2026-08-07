import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runGitCommand } from '../src/git/index.ts';
import type {
  ClosureFocusIntent,
  ClosurePlanOptions,
  ManagedWorkspaceTarget,
} from '../src/workspace-manager/index.ts';
import {
  openWithHerdr,
  planHerdrClosure,
  type HerdrAdapterDependencies,
} from '../src/workspace-manager/herdr-adapter.ts';
import { anyNumber, anyString, createTestRepo } from './helpers.ts';

const herdrBinary = Bun.which('herdr');
const integrationTest = herdrBinary ? test : test.skip;
const testDir = `/tmp/repos-test-herdr-real-${process.pid}`;
const repoPath = join(testDir, 'repo');
const barePath = join(testDir, 'bare.git');
const bareMainPath = join(testDir, 'bare-main');
const worktreePath = join(testDir, 'repo-feature');
const sessionName = `repos-test-${process.pid}`;
let dependencies: HerdrAdapterDependencies;

async function openManagedWorkspace(
  target: ManagedWorkspaceTarget,
  options: { focus: boolean; provider?: 'tmux' | 'herdr' }
): Promise<void> {
  await openWithHerdr(target, options.focus, dependencies);
}

async function planManagedWorkspaceClosure(
  targets: ManagedWorkspaceTarget[],
  focus: ClosureFocusIntent,
  options: ClosurePlanOptions = {}
) {
  return planHerdrClosure(targets, focus, options, dependencies);
}

async function runHerdr(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  if (!herdrBinary) throw new Error('Herdr is not installed');
  const proc = Bun.spawn([herdrBinary, '--session', sessionName, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

type RealHerdrWorkspace = {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  tab_count: number;
  active_tab_id: string;
  agent_status: string;
  worktree?: {
    checkout_path: string;
    is_linked_worktree: boolean;
    repo_key: string;
    repo_name: string;
    repo_root: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRealHerdrWorkspace(value: unknown): value is RealHerdrWorkspace {
  return (
    isRecord(value) &&
    typeof value.workspace_id === 'string' &&
    typeof value.number === 'number' &&
    typeof value.label === 'string' &&
    typeof value.focused === 'boolean' &&
    typeof value.pane_count === 'number' &&
    typeof value.tab_count === 'number' &&
    typeof value.active_tab_id === 'string' &&
    typeof value.agent_status === 'string'
  );
}

async function listWorkspaces(): Promise<RealHerdrWorkspace[]> {
  const result = await runHerdr(['workspace', 'list']);
  if (result.exitCode !== 0) throw new Error(result.stderr);
  const response: unknown = JSON.parse(result.stdout);
  if (
    !isRecord(response) ||
    !isRecord(response.result) ||
    !Array.isArray(response.result.workspaces) ||
    !response.result.workspaces.every(isRealHerdrWorkspace)
  ) {
    throw new Error('Herdr returned an invalid workspace list');
  }
  return response.result.workspaces;
}

describe.serial('real Herdr integration', () => {
  beforeAll(async () => {
    if (!herdrBinary) return;
    await rm(testDir, { recursive: true, force: true });
    await createTestRepo(repoPath);
    await runGitCommand(['branch', '-M', 'main'], repoPath);
    await runGitCommand(['clone', '--bare', repoPath, barePath], testDir);
    await runGitCommand(
      ['worktree', 'add', '-b', 'feature/real', worktreePath],
      repoPath
    );

    const server = Bun.spawn(
      [herdrBinary, '--session', sessionName, 'server'],
      { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }
    );
    server.unref();
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const listed = await runHerdr(['workspace', 'list']);
      if (listed.exitCode === 0) break;
      await Bun.sleep(50);
    }

    dependencies = {
      binary: herdrBinary,
      environment: {
        ...process.env,
        HERDR_ENV: '1',
        HERDR_BIN_PATH: herdrBinary,
        HERDR_SESSION: sessionName,
        HERDR_SOCKET_PATH: undefined,
        HERDR_WORKSPACE_ID: undefined,
      },
    };
  });

  afterAll(async () => {
    if (herdrBinary) {
      await runHerdr(['session', 'stop', sessionName, '--json']);
    }
    process.chdir(import.meta.dir.replace('/tests', ''));
    await rm(testDir, { recursive: true, force: true });
  });

  integrationTest(
    'uses one isolated-session workspace through open, reuse, and planned closure',
    async () => {
      const target = {
        repoName: 'repo',
        branch: 'feature/real',
        worktreePath,
      };
      await openManagedWorkspace(target, {
        focus: false,
        provider: 'herdr',
      });
      await openManagedWorkspace(target, {
        focus: false,
        provider: 'herdr',
      });

      const opened = await listWorkspaces();
      expect(
        opened.filter((workspace) => workspace.label === 'repo@feature-real')
      ).toEqual([
        {
          workspace_id: anyString(),
          number: anyNumber(),
          label: 'repo@feature-real',
          focused: false,
          pane_count: 1,
          tab_count: 1,
          active_tab_id: anyString(),
          agent_status: 'unknown',
          worktree: {
            checkout_path: worktreePath,
            is_linked_worktree: true,
            repo_key: anyString(),
            repo_name: 'repo',
            repo_root: repoPath,
          },
        },
      ]);

      const plan = await planManagedWorkspaceClosure(
        [target],
        { kind: 'automatic', candidates: [] },
        { provider: 'herdr' }
      );
      await runGitCommand(['worktree', 'remove', worktreePath], repoPath);
      await plan.execute();

      expect(
        (await listWorkspaces()).filter(
          (workspace) => workspace.label === 'repo@feature-real'
        )
      ).toEqual([]);
    }
  );

  integrationTest(
    'opens a bare repository without creating a checkout',
    async () => {
      const target = {
        repoName: 'bare',
        branch: 'main',
        worktreePath: barePath,
      };
      await openManagedWorkspace(target, {
        focus: false,
        provider: 'herdr',
      });
      await openManagedWorkspace(target, {
        focus: false,
        provider: 'herdr',
      });

      expect(
        await runGitCommand(['worktree', 'list', '--porcelain'], barePath)
      ).toEqual({
        stdout: `worktree ${barePath}\nbare`,
        stderr: '',
        exitCode: 0,
      });
      expect(
        (await listWorkspaces()).filter(
          (workspace) => workspace.label === 'bare@main'
        )
      ).toEqual([
        {
          workspace_id: anyString(),
          number: anyNumber(),
          label: 'bare@main',
          focused: false,
          pane_count: 1,
          tab_count: 1,
          active_tab_id: anyString(),
          agent_status: 'unknown',
        },
      ]);

      const plan = await planManagedWorkspaceClosure(
        [target],
        { kind: 'preserve', destination: { path: repoPath } },
        { provider: 'herdr' }
      );
      await plan.execute();
      expect(
        (await listWorkspaces()).filter(
          (workspace) => workspace.label === 'bare@main'
        )
      ).toEqual([]);
    }
  );

  integrationTest(
    'replaces a closing default-branch workspace with the bare destination',
    async () => {
      await runGitCommand(['worktree', 'add', bareMainPath, 'main'], barePath);
      const closingTarget = {
        repoName: 'bare',
        branch: 'main',
        worktreePath: bareMainPath,
      };
      const destination = {
        repoName: 'bare',
        branch: 'main',
        worktreePath: barePath,
      };
      await openManagedWorkspace(closingTarget, {
        focus: false,
        provider: 'herdr',
      });
      const plan = await planManagedWorkspaceClosure(
        [closingTarget],
        { kind: 'destination', target: destination },
        { provider: 'herdr' }
      );

      await runGitCommand(['worktree', 'remove', bareMainPath], barePath);
      await plan.execute();

      expect(
        (await listWorkspaces()).filter(
          (workspace) => workspace.label === 'bare@main'
        )
      ).toEqual([
        {
          workspace_id: anyString(),
          number: anyNumber(),
          label: 'bare@main',
          focused: true,
          pane_count: 1,
          tab_count: 1,
          active_tab_id: anyString(),
          agent_status: 'unknown',
          worktree: {
            checkout_path: barePath,
            is_linked_worktree: false,
            repo_key: barePath,
            repo_name: 'bare.git',
            repo_root: barePath,
          },
        },
      ]);
      expect(await Bun.file(join(bareMainPath, 'test.txt')).exists()).toBe(
        false
      );

      const destinationPlan = await planManagedWorkspaceClosure(
        [destination],
        { kind: 'preserve', destination: { path: repoPath } },
        { provider: 'herdr' }
      );
      await destinationPlan.execute();
    }
  );
});
