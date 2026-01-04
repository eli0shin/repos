import { expect } from 'bun:test';

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
