import { spyOn, type Mock } from 'bun:test';

export type MockExit = Mock<(code?: number) => never>;

export function mockProcessExit(): MockExit {
  return spyOn(process, 'exit').mockImplementation((code?: number) => {
    throw new Error(`process.exit(${code})`);
  });
}
