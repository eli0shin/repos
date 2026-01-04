import { dirname } from 'node:path';
import {
  fetchLatestVersion,
  isNewerVersion,
  isPrerelease,
  downloadBinary,
  replaceBinary,
} from './update.ts';
import { getUpdateStatePath, writeUpdateState } from './update-state.ts';
import type { UpdateBehavior, UpdateState } from './types.ts';

function toUpdateBehavior(value: string): UpdateBehavior {
  if (value === 'auto' || value === 'notify' || value === 'off') {
    return value;
  }
  return 'auto';
}

export async function runUpdaterWorker(): Promise<void> {
  const [currentVersion, binaryPath, behaviorArg] = process.argv.slice(3);

  if (!currentVersion || !binaryPath || !behaviorArg) {
    return;
  }

  const behavior = toUpdateBehavior(behaviorArg);
  const statePath = getUpdateStatePath();

  try {
    const releaseResult = await fetchLatestVersion();
    if (!releaseResult.success) {
      // Don't update timestamp on fetch failure - retry sooner
      return;
    }

    const { version: latestVersion, downloadUrl } = releaseResult.data;

    // Skip prerelease versions
    if (isPrerelease(latestVersion)) {
      await updateTimestamp(statePath);
      return;
    }

    if (!isNewerVersion(currentVersion, latestVersion)) {
      await updateTimestamp(statePath);
      return;
    }

    if (behavior === 'notify') {
      const state = {
        lastCheckedAt: Date.now(),
        pendingNotification: latestVersion,
      } satisfies UpdateState;
      await writeUpdateState(statePath, state);
      return;
    }

    // behavior === 'auto': download and install silently
    const binaryDir = dirname(binaryPath);
    const downloadResult = await downloadBinary(downloadUrl, binaryDir);
    if (!downloadResult.success) {
      await updateTimestamp(statePath);
      return;
    }

    const replaceResult = await replaceBinary(downloadResult.data, binaryPath);
    if (!replaceResult.success) {
      await updateTimestamp(statePath);
      return;
    }

    await updateTimestamp(statePath);
  } catch {
    // Don't update timestamp on errors - retry sooner
  }
}

async function updateTimestamp(statePath: string): Promise<void> {
  const state = {
    lastCheckedAt: Date.now(),
  } satisfies UpdateState;
  await writeUpdateState(statePath, state);
}
