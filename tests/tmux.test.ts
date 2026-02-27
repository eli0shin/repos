import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { getSessionName, isInsideTmux } from '../src/tmux.ts';

describe('getSessionName', () => {
  test('creates session name from repo and branch', () => {
    expect(getSessionName('myrepo', 'feature')).toBe('myrepo-feature');
  });

  test('replaces slashes in branch name with dashes', () => {
    expect(getSessionName('myrepo', 'feature/add-auth')).toBe(
      'myrepo-feature-add-auth'
    );
  });

  test('handles multiple slashes', () => {
    expect(getSessionName('myrepo', 'user/feature/deep')).toBe(
      'myrepo-user-feature-deep'
    );
  });
});

describe('isInsideTmux', () => {
  let originalTmux: string | undefined;

  beforeEach(() => {
    originalTmux = process.env.TMUX;
  });

  afterEach(() => {
    if (originalTmux === undefined) {
      delete process.env.TMUX;
    } else {
      process.env.TMUX = originalTmux;
    }
  });

  test('returns true when TMUX is set', () => {
    process.env.TMUX = '/tmp/tmux-1000/default,12345,0';
    expect(isInsideTmux()).toBe(true);
  });

  test('returns false when TMUX is not set', () => {
    delete process.env.TMUX;
    expect(isInsideTmux()).toBe(false);
  });

  test('returns false when TMUX is empty string', () => {
    process.env.TMUX = '';
    expect(isInsideTmux()).toBe(false);
  });
});
