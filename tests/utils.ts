import { spyOn, type Mock } from 'bun:test';

export type MockExit = Mock<(code?: number) => never>;

export const HERDR_ENVIRONMENT_KEYS = [
  'HERDR_ENV',
  'HERDR_SOCKET_PATH',
  'HERDR_CLIENT_SOCKET_PATH',
  'HERDR_SESSION',
  'HERDR_WORKSPACE_ID',
  'HERDR_TAB_ID',
  'HERDR_PANE_ID',
  'HERDR_BIN_PATH',
] as const;

export function isolateHerdrEnvironment(
  environment: Record<string, string | undefined>
): () => void {
  const inherited = new Map<string, string | undefined>();
  for (const key of HERDR_ENVIRONMENT_KEYS) {
    inherited.set(key, environment[key]);
    Reflect.deleteProperty(environment, key);
  }

  return () => {
    for (const key of HERDR_ENVIRONMENT_KEYS) {
      const value = inherited.get(key);
      if (value === undefined) Reflect.deleteProperty(environment, key);
      else environment[key] = value;
    }
  };
}

export function mockProcessExit(): MockExit {
  return spyOn(process, 'exit').mockImplementation((code?: number) => {
    throw new Error(`process.exit(${code})`);
  });
}
