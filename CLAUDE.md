# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# repos CLI

A Bun-based CLI tool for managing git repositories in `~/code`.

## Development

```bash
bun install                   # Install dependencies
bun test                      # Run all tests
bun test tests/git.test.ts    # Run a single test file
bun run build                 # Build executable
bun run lint                  # Run ESLint
bun run format                # Check formatting
```

## Architecture

- `src/cli.ts` - Entry point using Commander.js with typed commands
- `src/config.ts` - Config file read/write operations
- `src/git.ts` - Git command wrappers (clone, pull, worktree operations)
- `src/output.ts` - stdout/stderr output utilities
- `src/types.ts` - Core types (`RepoEntry`, `ReposConfig`, `OperationResult<T>`)
- `src/commands/` - Individual command implementations
- `src/auto-update.ts`, `src/update-state.ts`, `src/updater-worker.ts` - Background auto-update system

Commands receive a `CommandContext` with `configPath` and return results using the `OperationResult<T>` pattern:

```typescript
type OperationResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };
```

## Commands

| Command                        | Description                                   |
| ------------------------------ | --------------------------------------------- |
| `repos add <url> [--bare]`     | Clone a repo and add it to tracking           |
| `repos clone [name]`           | Clone repos from config (all or specific)     |
| `repos list`                   | List tracked repos with status                |
| `repos remove <name> [-d]`     | Untrack repo (-d to delete directory)         |
| `repos latest`                 | Parallel pull all repos                       |
| `repos adopt`                  | Add existing repos to config                  |
| `repos sync`                   | Adopt + clone missing                         |
| `repos work <branch> [repo]`   | Create a worktree for a branch                |
| `repos stack <branch>`         | Create a stacked worktree from current branch |
| `repos restack`                | Rebase current branch on its parent branch    |
| `repos unstack`                | Rebase onto default branch and remove stack   |
| `repos collapse`               | Collapse parent into current stacked branch   |
| `repos squash [-m msg] [-f]`   | Squash commits since base into single commit  |
| `repos clean <branch> [repo]`  | Remove a worktree (--force for parent branch) |
| `repos rebase [branch] [repo]` | Rebase worktree branch on default branch      |
| `repos cleanup [--dry-run]`    | Remove worktrees for merged/deleted branches  |
| `repos init`                   | Configure shell for work command              |
| `repos update`                 | Update repos CLI to latest version            |

## Config Location

`~/.config/repos/config.json` (or `$XDG_CONFIG_HOME/repos/config.json`) - JSON file with repo entries and settings

## Testing

Tests use real git operations on temp directories. No mocking of deterministic functions.

Write assertions on complete output: `expect(result).toEqual(...)` not `expect(result.status).toBe(...)` or `expect(result).toContain(...)`

Test helpers in `tests/helpers.ts`: `matchString()`, `anyString()`, `arrayContaining()`, `objectContaining()`

## Publishing

Uses changesets for versioning:
Use the /changeset slash command to create a changeset for each change
