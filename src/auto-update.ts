import {
  readUpdateState,
  shouldCheckForUpdate,
  getUpdateStatePath,
} from './update-state.ts';
import { print } from './output.ts';
import type { UpdateBehavior } from './types.ts';

type AutoUpdateResult = {
  message?: string;
};

type SpawnFn = (args: string[]) => void;

function defaultSpawn(args: string[]): void {
  const proc = Bun.spawn(args, {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  proc.unref();
}

export async function handleAutoUpdate(
  currentVersion: string,
  updateBehavior: UpdateBehavior,
  statePath: string = getUpdateStatePath(),
  spawnFn: SpawnFn = defaultSpawn
): Promise<AutoUpdateResult> {
  const stateResult = await readUpdateState(statePath);
  const state = stateResult.success ? stateResult.data : null;

  let message: string | undefined;

  // Check for pending notification (notify mode only)
  if (updateBehavior === 'notify' && state?.pendingNotification) {
    message = `Update available: v${state.pendingNotification}`;
  }

  // If off, don't spawn updater
  if (updateBehavior === 'off') {
    return { message };
  }

  // Check cooldown
  if (!shouldCheckForUpdate(state)) {
    return { message };
  }

  // Spawn detached updater process
  const binaryPath = process.execPath;
  spawnFn([
    binaryPath,
    '--update-worker',
    currentVersion,
    binaryPath,
    updateBehavior,
  ]);

  return { message };
}

export function printUpdateMessage(message: string | undefined): void {
  if (message) {
    print(message);
  }
}
