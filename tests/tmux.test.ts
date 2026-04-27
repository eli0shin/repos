import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  getSessionName,
  isInsideTmux,
  matchSession,
  tmuxHasSession,
  tmuxKillSession,
} from '../src/tmux.ts';

describe('getSessionName', () => {
  test('creates session name from repo and branch', () => {
    expect(getSessionName('myrepo', 'feature')).toBe('myrepo@feature');
  });

  test('replaces slashes in branch name with dashes', () => {
    expect(getSessionName('myrepo', 'feature/add-auth')).toBe(
      'myrepo@feature-add-auth'
    );
  });

  test('handles multiple slashes', () => {
    expect(getSessionName('myrepo', 'user/feature/deep')).toBe(
      'myrepo@user-feature-deep'
    );
  });

  test('avoids collision between repo-with-dash+branch vs repo+branch-with-dash', () => {
    // "foo-bar" repo + "baz" branch vs "foo" repo + "bar-baz" branch
    expect(getSessionName('foo-bar', 'baz')).toBe('foo-bar@baz');
    expect(getSessionName('foo', 'bar-baz')).toBe('foo@bar-baz');
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

describe('tmuxKillSession', () => {
  test('returns error when session does not exist', async () => {
    const result = await tmuxKillSession('nonexistent-session-67890');
    expect(result.success).toBe(false);
  });
});

describe('matchSession', () => {
  test('matches by primary candidate name (repo@branch)', () => {
    const sessions = [
      { name: 'myrepo@main', path: '/home/user/code/myrepo' },
      { name: 'other@feature', path: '/home/user/code/other' },
    ];
    expect(
      matchSession(
        sessions,
        ['myrepo@main', 'myrepo'],
        '/home/user/code/myrepo'
      )
    ).toBe('myrepo@main');
  });

  test('matches by secondary candidate name (bare repo name)', () => {
    const sessions = [
      { name: 'myrepo', path: '/home/user/code/myrepo' },
      { name: 'other@feature', path: '/home/user/code/other' },
    ];
    expect(
      matchSession(
        sessions,
        ['myrepo@main', 'myrepo'],
        '/home/user/code/myrepo'
      )
    ).toBe('myrepo');
  });

  test('falls back to cwd match when no name matches', () => {
    const sessions = [{ name: 'custom-name', path: '/home/user/code/myrepo' }];
    expect(
      matchSession(
        sessions,
        ['myrepo@main', 'myrepo'],
        '/home/user/code/myrepo'
      )
    ).toBe('custom-name');
  });

  test('cwd fallback matches subdirectory', () => {
    const sessions = [
      { name: 'custom-name', path: '/home/user/code/myrepo/src' },
    ];
    expect(
      matchSession(
        sessions,
        ['myrepo@main', 'myrepo'],
        '/home/user/code/myrepo'
      )
    ).toBe('custom-name');
  });

  test('cwd fallback does not match sibling directory', () => {
    const sessions = [
      { name: 'custom-name', path: '/home/user/code/myrepo-feature' },
    ];
    expect(
      matchSession(
        sessions,
        ['myrepo@main', 'myrepo'],
        '/home/user/code/myrepo'
      )
    ).toBeNull();
  });

  test('prefers name match over cwd match', () => {
    const sessions = [
      { name: 'cwd-match', path: '/home/user/code/myrepo' },
      { name: 'myrepo', path: '/somewhere/else' },
    ];
    expect(
      matchSession(
        sessions,
        ['myrepo@main', 'myrepo'],
        '/home/user/code/myrepo'
      )
    ).toBe('myrepo');
  });

  test('returns null when nothing matches', () => {
    const sessions = [{ name: 'unrelated', path: '/home/user/code/other' }];
    expect(
      matchSession(
        sessions,
        ['myrepo@main', 'myrepo'],
        '/home/user/code/myrepo'
      )
    ).toBeNull();
  });

  test('returns null for empty session list', () => {
    expect(
      matchSession([], ['myrepo@main', 'myrepo'], '/home/user/code/myrepo')
    ).toBeNull();
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
