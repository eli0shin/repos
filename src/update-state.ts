import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OperationResult, UpdateState } from './types.ts';

const DEFAULT_STATE_PATH = join(homedir(), '.repos-update-state');
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getUpdateStatePath(): string {
  return DEFAULT_STATE_PATH;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUpdateState(value: unknown): value is UpdateState {
  if (!isRecord(value)) return false;
  return typeof value.lastCheckedAt === 'number';
}

export async function readUpdateState(
  statePath: string = DEFAULT_STATE_PATH
): Promise<OperationResult<UpdateState | null>> {
  const file = Bun.file(statePath);

  if (!(await file.exists())) {
    return { success: true, data: null };
  }

  try {
    const content: unknown = await file.json();
    if (!isUpdateState(content)) {
      return { success: true, data: null };
    }
    return { success: true, data: content };
  } catch {
    return { success: true, data: null };
  }
}

export async function writeUpdateState(
  statePath: string,
  state: UpdateState
): Promise<OperationResult> {
  try {
    await Bun.write(statePath, JSON.stringify(state, null, 2) + '\n');
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: 'Failed to write update state' };
  }
}

export function shouldCheckForUpdate(state: UpdateState | null): boolean {
  if (!state) return true;
  return Date.now() - state.lastCheckedAt >= COOLDOWN_MS;
}
