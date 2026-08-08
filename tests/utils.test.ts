import { describe, expect, test } from 'bun:test';
import { HERDR_ENVIRONMENT_KEYS, isolateHerdrEnvironment } from './utils.ts';

describe('isolateHerdrEnvironment', () => {
  test('clears and restores all inherited Herdr markers', () => {
    const inherited = Object.fromEntries(
      HERDR_ENVIRONMENT_KEYS.map((key) => [key, `${key}-value`])
    );
    const environment = { PATH: '/bin', ...inherited };

    const restore = isolateHerdrEnvironment(environment);
    expect(environment).toEqual({ PATH: '/bin' });

    restore();
    expect(environment).toEqual({ PATH: '/bin', ...inherited });
  });
});
