export function print(message: string): void {
  process.stdout.write(message + '\n');
}

export function printError(message: string): void {
  process.stderr.write(message + '\n');
}

// Status messages to stderr (keeps stdout clean for data output like paths)
export function printStatus(message: string): void {
  process.stderr.write(message + '\n');
}
