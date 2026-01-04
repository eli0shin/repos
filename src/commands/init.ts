import { homedir } from 'node:os';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { print, printError } from '../output.ts';

const BASH_ZSH_FUNCTION = `
work() {
  local output
  output=$(repos work "$@" 2>&1)
  local exit_code=$?
  if [ $exit_code -eq 0 ]; then
    local path=$(echo "$output" | tail -n1)
    if [ -d "$path" ]; then
      cd "$path"
    else
      echo "$output"
    fi
  else
    echo "$output" >&2
    return $exit_code
  fi
}
`;

const FISH_FUNCTION = `
function work
  set -l output (repos work $argv 2>&1)
  set -l exit_code $status
  if test $exit_code -eq 0
    set -l path (echo $output | tail -n1)
    if test -d $path
      cd $path
    else
      echo $output
    end
  else
    echo $output >&2
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

export async function initCommand(): Promise<void> {
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
  if (existsSync(configFile)) {
    const content = readFileSync(configFile, 'utf-8');
    if (content.includes('repos init')) {
      print(`Already configured in ${configFile}`);
      print(`Restart your shell or run: source ${configFile}`);
      return;
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

  print(`Added repos init to ${configFile}`);
  print(`Restart your shell or run: source ${configFile}`);
}
