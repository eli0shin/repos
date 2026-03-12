# Implementation Plan: PR #58 Review Feedback

## Overview

Seven issues to address from PR review. Three are in separate commits (the git/core.ts changes should be split out), so the plan groups work into logical commits.

---

## Commit Order

The changes are ordered to minimize conflicts and keep each commit independently testable:

1. **Commit A** (Issue 7 + Issues 4 & 5): Extract `runGitCommandInteractive` improvements into their own commit
2. **Commit B** (Issues 1, 2, 6): Fix the `--tmux` flag wiring (dedup, cli cleanup, shell wrapper)
3. **Commit C** (Issue 3): Add tests for `--tmux` flag

This ordering matters because:

- The git/core.ts changes are unrelated to `--tmux` and should land first as a standalone improvement
- The `--tmux` code fixes should land before tests are written (TDD is for new features; these are fixes to existing code)
- Tests go last so they validate the final state

---

## Commit A: Fix `runGitCommandInteractive` (Issues 4, 5, 7)

### Files to modify

- `src/git/core.ts`
- `src/git/rebase.ts` (caller update if return type changes)

### Approach

**Issue 5 (env inconsistency):** Add `env: process.env` to the TTY branch of `runGitCommandInteractive` so both paths explicitly inherit the environment.

**Issue 4 (discarded output):** Change the return type from `Promise<number>` to `Promise<GitCommandResult>` to match `runGitCommand`. This is cleaner than silent logging and gives callers access to stderr for error messages.

The blast radius is small — only one caller:

- `src/git/rebase.ts:83` — `rebaseContinue()` uses `const exitCode = await runGitCommandInteractive(...)` then checks `exitCode !== 0`

Update `rebaseContinue` to destructure `{ exitCode }` from the result (or `{ exitCode, stderr }` to improve its own error messages).

### Changes to `src/git/core.ts` (lines 27-55)

```typescript
export async function runGitCommandInteractive(
  args: string[],
  cwd?: string
): Promise<GitCommandResult> {
  if (process.stdin.isTTY) {
    const proc = Bun.spawn(['git', ...args], {
      cwd,
      env: process.env, // Issue 5: explicit env
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const exitCode = await proc.exited;
    // stdout/stderr are inherited (printed to terminal), not capturable
    return { stdout: '', stderr: '', exitCode };
  }

  // Non-TTY (test/CI): fall back to piped I/O with a no-op editor
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    env: { ...process.env, GIT_EDITOR: 'true' },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}
```

### Changes to `src/git/rebase.ts` (line 83-86)

```typescript
const result = await runGitCommandInteractive(
  ['rebase', '--continue'],
  repoDir
);

if (result.exitCode !== 0) {
  // ... existing error handling unchanged
```

### Verification

- `bun test tests/worktree.test.ts` — rebase/continue tests exercise `runGitCommandInteractive` in non-TTY mode
- `bun run lint`
- Verify `rebaseContinue` still produces correct error messages

---

## Commit B: Fix `--tmux` flag wiring (Issues 1, 2, 6)

### Files to modify

- `src/commands/work.ts` (Issue 1: dedup)
- `src/cli.ts` (Issue 2: remove `?? false`)
- `src/commands/init.ts` (Issue 6: shell wrapper guard)

### Issue 1: Deduplicate tmux blocks in `work.ts`

Restructure `workCommand` so it computes `worktreePath` from either path (existing worktree found, or new worktree created), then does the tmux-or-print decision once at the end.

```typescript
export async function workCommand(
  ctx: CommandContext,
  branch: string,
  repoName?: string,
  options?: { tmux?: boolean }
): Promise<void> {
  const config = await loadConfig(ctx.configPath);
  const repo = await resolveRepo(config, repoName);

  // Check if worktree already exists
  const worktreesResult = await listWorktrees(repo.path);
  if (worktreesResult.success) {
    const existing = findWorktreeByBranch(worktreesResult.data, branch);
    if (existing) {
      if (options?.tmux) {
        await openTmuxSession(repo.name, branch, existing.path);
      } else {
        print(existing.path);
      }
      return;
    }
  }

  // ... create worktree ...

  const worktreePath = getWorktreePath(repo.path, branch);
  // ... createWorktree, recordStack, printStatus ...

  if (options?.tmux) {
    await openTmuxSession(repo.name, branch, worktreePath);
  } else {
    print(worktreePath);
  }
}
```

Wait — actually, the early return case for existing worktrees has fundamentally different control flow (it returns immediately, skipping creation). The two `if (options?.tmux)` blocks are at different stages of the function with different variables (`existing.path` vs `worktreePath`).

**Revised approach:** Extract a helper function to avoid repeating the conditional:

```typescript
function outputWorktreeResult(
  repoName: string,
  branch: string,
  path: string,
  tmux?: boolean
): Promise<void> {
  if (tmux) {
    return openTmuxSession(repoName, branch, path);
  }
  print(path);
  return Promise.resolve();
}
```

Then both sites become:

```typescript
await outputWorktreeResult(repo.name, branch, existing.path, options?.tmux);
// and
await outputWorktreeResult(repo.name, branch, worktreePath, options?.tmux);
```

**Alternative (simpler):** Restructure to compute `worktreePath` early, then have one exit point:

```typescript
let worktreePath: string;

const worktreesResult = await listWorktrees(repo.path);
const existing = worktreesResult.success
  ? findWorktreeByBranch(worktreesResult.data, branch)
  : undefined;

if (existing) {
  worktreePath = existing.path;
} else {
  // ... create worktree ...
  worktreePath = getWorktreePath(repo.path, branch);
  // ... createWorktree, recordStack, printStatus ...
}

if (options?.tmux) {
  await openTmuxSession(repo.name, branch, worktreePath);
} else {
  print(worktreePath);
}
```

**Decision:** Use the restructured approach (single exit point). It's cleaner and directly addresses the review feedback. The `let` is fine since assignment happens exactly once per path.

### Issue 2: Remove `?? false` in `cli.ts`

Lines 149-151 and 160-162: Change from:

```typescript
{
  tmux: options.tmux ?? false;
}
```

to:

```typescript
{
  tmux: options.tmux;
}
```

Commander boolean flags produce `true | undefined`. The commands check `options?.tmux` which is a truthy check — `undefined` is already falsy. The `?? false` adds nothing.

### Issue 6: Shell wrapper guard for `--tmux`

The `work()` shell function uses command substitution `$( )` to capture stdout. When `--tmux` is passed, the command doesn't print a path — it spawns tmux. If tmux tries to `attach-session` with `stdout: 'inherit'`, that stdout is captured by the subshell, breaking the interactive tmux experience.

**Fix for bash/zsh `BASH_ZSH_FUNCTION`:**

```bash
work() {
  for arg in "$@"; do
    if [ "$arg" = "--tmux" ] || [ "$arg" = "-t" ]; then
      repos work "$@"
      return $?
    fi
  done
  local path
  path=$(repos work "$@")
  local exit_code=$?
  if [ $exit_code -eq 0 ] && [ -d "$path" ]; then
    cd "$path"
  else
    return $exit_code
  fi
}
```

**Fix for fish `FISH_FUNCTION`:**

```fish
function work
  for arg in $argv
    if test "$arg" = "--tmux" -o "$arg" = "-t"
      repos work $argv
      return $status
    end
  end
  set -l path (repos work $argv)
  set -l exit_code $status
  if test $exit_code -eq 0; and test -d "$path"
    cd $path
  else
    return $exit_code
  end
end
```

Note: Only the `work` function needs the guard, not `work-clean` or `work-main` (those commands don't have `--tmux`).

### Verification

- `bun test tests/worktree.test.ts` — existing work/stack tests still pass
- `bun test tests/init.test.ts` — init tests still pass
- `bun run lint`
- Manual: verify `repos init --print` outputs the updated shell functions

---

## Commit C: Add tests for `--tmux` flag (Issue 3)

### Files to modify

- `tests/worktree.test.ts` (add new test block)

### Approach

`openTmuxSession` calls external `tmux` commands (non-deterministic process interaction), so mocking it is appropriate per CLAUDE.md rules.

Use Bun's `mock.module` to mock the `../src/tmux.ts` module at the module level, replacing `openTmuxSession` with a spy. This avoids needing a live tmux server.

### Tests to add

**Test group: `repos work --tmux`**

1. **`work --tmux calls openTmuxSession for new worktree`**
   - Set up bare repo + config
   - Mock `openTmuxSession` to be a no-op spy
   - Call `workCommand(ctx, 'feature', 'bare', { tmux: true })`
   - Assert `openTmuxSession` was called with `('bare', 'feature', expectedPath)`
   - Capture stdout and assert nothing was printed (no path output)

2. **`work --tmux calls openTmuxSession for existing worktree`**
   - Set up bare repo + config, create worktree first (without tmux)
   - Mock `openTmuxSession`
   - Call `workCommand(ctx, 'feature', 'bare', { tmux: true })` again
   - Assert `openTmuxSession` was called with the existing worktree path
   - Assert nothing printed to stdout

3. **`work without --tmux prints path (no openTmuxSession call)`**
   - Set up bare repo + config
   - Mock `openTmuxSession`
   - Call `workCommand(ctx, 'feature', 'bare')` (no tmux option)
   - Assert `openTmuxSession` was NOT called
   - Assert stdout received the worktree path

**Test group: `repos stack --tmux`**

4. **`stack --tmux calls openTmuxSession`**
   - Set up bare repo + config with a worktree
   - `process.chdir()` into the existing worktree
   - Mock `openTmuxSession`
   - Call `stackCommand(ctx, 'stacked-branch', { tmux: true })`
   - Assert `openTmuxSession` was called with `('repoName', 'stacked-branch', expectedPath)`
   - Assert nothing printed to stdout

5. **`stack without --tmux prints path`**
   - Same setup
   - Call `stackCommand(ctx, 'stacked-branch')` (no tmux option)
   - Assert `openTmuxSession` was NOT called
   - Assert stdout received path

### Mocking strategy

```typescript
import { mock, spyOn } from 'bun:test';

// At top of test file or describe block:
const mockOpenTmuxSession = mock(() => Promise.resolve());
mock.module('../src/tmux.ts', () => ({
  openTmuxSession: mockOpenTmuxSession,
}));
```

**Important caveat:** Bun's `mock.module` replaces the entire module. We need to re-export the other functions from `tmux.ts` that might be used, or use `spyOn` if possible. Check if `workCommand` and `stackCommand` only import `openTmuxSession` from `tmux.ts` — yes, confirmed from the imports in both files.

However, `mock.module` affects all imports globally. To avoid polluting other test files, these tmux-flag tests should be in a **separate test file** (e.g., `tests/tmux-flag.test.ts`) that can mock the module independently.

### Output assertion pattern

Follow the existing pattern from worktree.test.ts:

```typescript
const captured: string[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk: string) => {
  captured.push(chunk);
  return true;
};
try {
  await workCommand(ctx, 'feature', 'bare', { tmux: true });
} finally {
  process.stdout.write = originalWrite;
}
expect(captured).toEqual([]); // nothing printed when tmux: true
```

### Verification

- `bun test tests/tmux-flag.test.ts` — new tests pass
- `bun test` — all tests pass (mock isolation confirmed)

---

## Concerns and Tradeoffs

### Return type change for `runGitCommandInteractive` (Issue 4)

- **Tradeoff:** The TTY path returns `{ stdout: '', stderr: '', exitCode }` because output goes directly to the terminal. Callers checking `result.stderr` in TTY mode will get an empty string. This is accurate (the output was sent to the terminal, not captured) but callers should be aware.
- **Blast radius:** Only `rebaseContinue` in `src/git/rebase.ts` calls it. Low risk.

### Shell wrapper `--tmux` detection (Issue 6)

- **Tradeoff:** The arg loop is a simple string match. It correctly handles `--tmux` and `-t` anywhere in the argument list. It doesn't handle edge cases like `--tmux=false` or `--no-tmux` — but Commander doesn't support those forms for boolean flags, so this is fine.
- **Concern:** If a future branch name happens to be literally `--tmux` or `-t`, the guard would trigger incorrectly. This is extremely unlikely and matches standard shell tool behavior (flags before positional args).

### Test file location (Issue 3)

- **Decision:** Create a new `tests/tmux-flag.test.ts` rather than adding to `tests/worktree.test.ts`. Module-level mocking with `mock.module` is global and would affect all tests in the same file. Isolation requires a separate file.

### Commit splitting (Issue 7)

- The git/core.ts TTY-detection was introduced in commit `f29bccf` ("fix: propagate env to git subprocesses and avoid interactive hangs in non-TTY"). It's already a separate commit from the tmux flag work (`0ac85db`). The review feedback may be about the PR containing both commits. If using squash merge, these should be separate PRs. If using merge commits, the existing commit separation is already correct. The plan addresses this by keeping the fixes in separate commits.
