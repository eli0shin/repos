import { dirname } from 'node:path';
import { version } from '../../package.json';
import { print, printError } from '../output.ts';
import {
  fetchLatestVersion,
  isNewerVersion,
  downloadBinary,
  replaceBinary,
} from '../update.ts';

export async function updateCommand(): Promise<void> {
  print(`Current version: ${version}`);
  print('Checking for updates...');

  const releaseResult = await fetchLatestVersion();
  if (!releaseResult.success) {
    printError(`Error checking for updates: ${releaseResult.error}`);
    process.exit(1);
  }

  const { version: latestVersion, downloadUrl } = releaseResult.data;

  if (!isNewerVersion(version, latestVersion)) {
    print(`Already on latest version (v${version})`);
    return;
  }

  print(`Updating to v${latestVersion}...`);

  const binaryPath = process.execPath;
  const binaryDir = dirname(binaryPath);

  const downloadResult = await downloadBinary(downloadUrl, binaryDir);
  if (!downloadResult.success) {
    printError(`Error downloading update: ${downloadResult.error}`);
    process.exit(1);
  }

  const replaceResult = await replaceBinary(downloadResult.data, binaryPath);
  if (!replaceResult.success) {
    printError(`Error installing update: ${replaceResult.error}`);
    process.exit(1);
  }

  print(`Updated to v${latestVersion}`);
}
