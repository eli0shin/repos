import { homedir } from 'node:os';
import {
  existsSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { print, printError } from '../output.ts';

const BASH_ZSH_FUNCTION = `
work() {
  local path
  path=$(repos work "$@")
  local exit_code=$?
  if [ $exit_code -eq 0 ] && [ -d "$path" ]; then
    cd "$path"
  else
    return $exit_code
  fi
}

work-clean() {
  local path
  path=$(repos clean "$@")
  local exit_code=$?
  if [ $exit_code -eq 0 ] && [ -d "$path" ]; then
    cd "$path"
  else
    return $exit_code
  fi
}
`;

const FISH_FUNCTION = `
function work
  set -l path (repos work $argv)
  set -l exit_code $status
  if test $exit_code -eq 0; and test -d "$path"
    cd $path
  else
    return $exit_code
  end
end

function work-clean
  set -l path (repos clean $argv)
  set -l exit_code $status
  if test $exit_code -eq 0; and test -d "$path"
    cd $path
  else
    return $exit_code
  end
end
`;

export function initPrintCommand(): void {
  const shell = process.env.SHELL || '/bin/bash';
  const shellName = basename(shell);

  if (shellName === 'bash' || shellName === 'zsh') {
    print(BASH_ZSH_FUNCTION);
  } else if (shellName === 'fish') {
    print(FISH_FUNCTION);
  } else {
    printError(`Unsupported shell: ${shellName}`);
    process.exit(1);
  }
}

function removeExistingBlock(content: string): string {
  const marker = '# repos CLI work command';
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) return content;

  // Find start (include preceding newline if exists)
  const start =
    markerIndex > 0 && content[markerIndex - 1] === '\n'
      ? markerIndex - 1
      : markerIndex;

  // Find end (after the eval/source line + newline)
  const afterMarker = content.indexOf('\n', markerIndex);
  const afterInitLine = content.indexOf('\n', afterMarker + 1);
  const end = afterInitLine !== -1 ? afterInitLine + 1 : content.length;

  return content.slice(0, start) + content.slice(end);
}

export async function initCommand(force = false): Promise<void> {
  const shell = process.env.SHELL || '/bin/bash';
  const shellName = basename(shell);
  const home = homedir();

  let configFile: string;
  let initLine: string;

  if (shellName === 'zsh') {
    configFile = join(home, '.zshrc');
    initLine = 'eval "$(repos init --print)"';
  } else if (shellName === 'bash') {
    // Prefer .bashrc, fall back to .bash_profile
    configFile = existsSync(join(home, '.bashrc'))
      ? join(home, '.bashrc')
      : join(home, '.bash_profile');
    initLine = 'eval "$(repos init --print)"';
  } else if (shellName === 'fish') {
    configFile = join(home, '.config', 'fish', 'config.fish');
    initLine = 'repos init --print | source';
  } else {
    printError(`Unsupported shell: ${shellName}`);
    process.exit(1);
  }

  // Check if already configured
  let isUpdate = false;
  if (existsSync(configFile)) {
    const content = readFileSync(configFile, 'utf-8');
    if (content.includes('repos init')) {
      if (force) {
        // Remove existing block and continue to re-add
        const newContent = removeExistingBlock(content);
        writeFileSync(configFile, newContent);
        isUpdate = true;
      } else {
        print(`Already configured in ${configFile}`);
        print(`Restart your shell or run: source ${configFile}`);
        return;
      }
    }
  } else {
    // Create parent directories if they don't exist (for fish config)
    const parentDir = dirname(configFile);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
  }

  // Append to config file
  const block = `\n# repos CLI work command\n${initLine}\n`;
  appendFileSync(configFile, block);

  print(
    `${isUpdate ? 'Updated' : 'Added'} repos init ${isUpdate ? 'in' : 'to'} ${configFile}`
  );
  print(`Restart your shell or run: source ${configFile}`);
}
