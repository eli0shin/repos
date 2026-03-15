import { expect } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runGitCommand } from '../src/git/index.ts';

export async function createTestRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await runGitCommand(['init'], dir);
  await runGitCommand(['config', 'user.email', 'test@test.com'], dir);
  await runGitCommand(['config', 'user.name', 'Test'], dir);
  await Bun.write(join(dir, 'test.txt'), 'test');
  await runGitCommand(['add', '.'], dir);
  await runGitCommand(['commit', '-m', 'initial'], dir);
}

export function matchString(regex: RegExp): string {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return expect.stringMatching(regex) as unknown as string;
}

export function anyString(): string {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return expect.any(String) as unknown as string;
}

export function arrayContaining<T>(arr: T[]): T[] {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return expect.arrayContaining(arr) as unknown as T[];
}

export function objectContaining<T extends object>(obj: T): T {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return expect.objectContaining(obj) as unknown as T;
}
