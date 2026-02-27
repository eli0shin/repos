import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { getSessionName, isInsideTmux, tmuxHasSession } from '../src/tmux.ts';

describe('getSessionName', () => {
  test('creates session name from repo and branch', () => {
    expect(getSessionName('myrepo', 'feature')).toBe('myrepo:feature');
  });

  test('replaces slashes in branch name with dashes', () => {
    expect(getSessionName('myrepo', 'feature/add-auth')).toBe(
      'myrepo:feature-add-auth'
    );
  });

  test('handles multiple slashes', () => {
    expect(getSessionName('myrepo', 'user/feature/deep')).toBe(
      'myrepo:user-feature-deep'
    );
  });

  test('avoids collision between repo-with-dash+branch vs repo+branch-with-dash', () => {
    // "foo-bar" repo + "baz" branch vs "foo" repo + "bar-baz" branch
    expect(getSessionName('foo-bar', 'baz')).toBe('foo-bar:baz');
    expect(getSessionName('foo', 'bar-baz')).toBe('foo:bar-baz');
  });
});

describe('tmuxHasSession', () => {
  test('returns { success: true, data: false } when no tmux server is running', async () => {
    // In CI (no tmux server running), tmux has-session exits with code 1.
    // The fixed code treats exit code 1 as "session not found" (not an error).
    const result = await tmuxHasSession('nonexistent-session-12345');
    expect(result).toEqual({ success: true, data: false });
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
