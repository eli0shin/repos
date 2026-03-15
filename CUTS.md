# repos CLI: What to Cut

## 1. Core Workflow

The tool does two things:

1. **Track repos** in a config file so you can clone them on a new machine.
2. **Worktree workflow**: for bare repos, create/destroy worktrees per branch instead of switching branches.

The day-to-day loop is: `repos work <branch>` to start working, `repos cleanup` to garbage-collect when done. Everything else is setup or maintenance.

---

## 2. Cut Entirely

### `sync` — Delete it

`sync` is `adopt` + `clone` bolted together, but its adopt phase is a degraded copy of the real `adopt`. It doesn't detect bare repos (marks them as regular), doesn't filter worktrees (adopts them as separate repos, corrupting the config). The real `adopt` handles both correctly (`src/commands/adopt.ts:92-115`).

A user who wants sync behavior can run `repos adopt && repos clone`. Two correct commands composed is better than one buggy command.

### `rebase` — Delete it

`rebase` auto-aborts on conflict (`src/git.ts:347-352`). This is actively harmful — the user runs `repos rebase`, it silently throws away the conflict state, and prints "Rebase aborted." The user has no chance to resolve conflicts, inspect the state, or make a decision. That's worse than not having the command, because `git rebase origin/main` in the worktree already works and leaves conflicts in place for the user to resolve.

This command wraps a single git operation (`fetch` + `rebase`) and makes it worse. The worktree workflow already puts you in a normal git directory — just use git.

### `update` — Delete it

The auto-update system already handles updates. With `behavior: 'auto'` (the default), the CLI silently updates itself in the background. The manual `update` command is a leftover from before auto-update existed. Keeping both means maintaining two code paths for the same operation.

If auto-update is off, the user chose that deliberately and can reinstall manually. The `update` command doesn't add value in any configuration.

### `clean` (single worktree removal) — Delete it

`clean` removes one worktree by branch name. `cleanup` removes all worktrees whose branches are merged or upstream-deleted. In practice:

- If the branch is merged, `cleanup` handles it.
- If the branch isn't merged, you probably don't want to delete the worktree yet.
- The edge case (force-remove an unmerged worktree) is `git worktree remove <path>`.

`clean` also duplicates safety checks that `cleanup` already has (uncommitted changes guard). Two commands for worktree removal is one too many. Keep `cleanup`, which is the batch operation that matches the workflow.

---

## 3. Simplify / Merge

### `latest` — Fix for bare repos

`latest` uses `isGitRepo()` to check if a repo exists (`src/commands/latest.ts:30`), which returns `false` for bare repos. So every bare repo shows as "not cloned." For bare repos, `latest` should `git fetch --all` instead of `git pull`, since there's no working tree to pull into. This is a fix, not a cut — `latest` is legitimately useful for keeping your repos current.

### `adopt` — Already correct, keep as-is

`adopt` properly handles bare repos, filters worktrees, detects single-repo vs. directory mode. It's the canonical way to register existing repos. No changes needed.

### `remove --delete` — Fix worktree cleanup

`remove --delete` does `rm -rf` on the repo path (`src/commands/remove.ts:39-44`) without cleaning up worktrees first. For a bare repo with 3 worktrees, this leaves orphaned worktree directories on disk. It should list worktrees and remove them before deleting the bare repo directory.

It also uses `isGitRepo()` instead of `isGitRepoOrBare()`, so `--delete` on a bare repo prints "Directory not found or not a git repo" and doesn't delete it.

---

## 4. Actively Harmful

| Issue                                     | Location                       | Impact                                                                         |
| ----------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| `rebase` auto-aborts conflicts            | `src/git.ts:347-352`           | Destroys conflict state the user needs to resolve. Worse than `git rebase`.    |
| `sync` adopts worktrees as repos          | `src/commands/sync.ts:30-47`   | Corrupts config. Worktrees appear as standalone repos.                         |
| `sync` doesn't detect bare repos          | `src/commands/sync.ts:39-43`   | Bare repos get adopted without `bare: true`. `work` command will fail on them. |
| `remove --delete` ignores worktrees       | `src/commands/remove.ts:38-44` | Orphans worktree directories on disk.                                          |
| `remove --delete` can't delete bare repos | `src/commands/remove.ts:39`    | Uses `isGitRepo()` which returns false for bare repos.                         |
| `latest` skips bare repos                 | `src/commands/latest.ts:30`    | Shows bare repos as "not cloned" instead of fetching.                          |
| `list` skips bare repos                   | `src/commands/list.ts:24`      | Uses `isGitRepo()` — bare repos show as "not cloned" even when they exist.     |

---

## 5. Over-engineered Infrastructure

### Auto-update system (4 files, ~335 lines)

Files: `update.ts`, `update-state.ts`, `auto-update.ts`, `updater-worker.ts`

This spawns a detached background process on every CLI invocation to check GitHub releases, with cooldown state persisted to disk, three behavior modes, and a notification system. For a single-user CLI that could just check on `repos list` or similar low-frequency commands, this is a lot of machinery.

The system works, but the cost is real:

- Every invocation spawns a child process (even `repos list`)
- State file management (`~/.repos-update-state`)
- Three behavior modes to test and maintain
- The worker is invoked by re-executing the binary with `--update-worker`, adding an implicit subcommand to the CLI's argument parsing

**Recommendation**: Simplify to a single inline version check on commands that already hit the network (`latest`, `clone`). Drop the background worker, state file, and behavior modes. If an update is available, print a message. If you want auto-update, use a package manager.

---

## 6. Proposed Final Command Set

### 8 commands (down from 13)

| Command                          | Purpose                                      | Status                                      |
| -------------------------------- | -------------------------------------------- | ------------------------------------------- |
| `repos list`                     | Show tracked repos and worktrees             | **Keep** (fix bare repo detection)          |
| `repos add <url> [--bare]`       | Clone + track a repo                         | **Keep**                                    |
| `repos clone [name]`             | Clone tracked repos that don't exist on disk | **Keep**                                    |
| `repos remove <name> [--delete]` | Untrack (optionally delete)                  | **Keep** (fix bare repo + worktree cleanup) |
| `repos latest`                   | Fetch/pull all repos in parallel             | **Keep** (fix bare repo handling)           |
| `repos adopt`                    | Register existing local repos to config      | **Keep**                                    |
| `repos work <branch> [repo]`     | Create worktree, output path for `cd`        | **Keep**                                    |
| `repos cleanup [--dry-run]`      | Remove worktrees for merged/deleted branches | **Keep**                                    |

### Support

| Item               | Status                                               |
| ------------------ | ---------------------------------------------------- |
| `repos init`       | **Keep** (required for `work` to `cd`)               |
| Auto-update system | **Simplify** to inline check, drop background worker |

### Cut

| Command  | Reason                                                                     |
| -------- | -------------------------------------------------------------------------- |
| `sync`   | Buggy duplicate of `adopt` + `clone`. Use them separately.                 |
| `rebase` | Wraps one git command and makes it worse (auto-aborts conflicts).          |
| `update` | Redundant with auto-update.                                                |
| `clean`  | `cleanup` handles the common case; `git worktree remove` handles the rest. |

### Required Fixes

1. **`list`**: Use `isGitRepoOrBare()` instead of `isGitRepo()` so bare repos show correct status.
2. **`latest`**: Use `isGitRepoOrBare()` for existence check. For bare repos, run `git fetch --all` instead of `git pull`.
3. **`remove --delete`**: Use `isGitRepoOrBare()`. Clean up worktrees before deleting the repo directory.
