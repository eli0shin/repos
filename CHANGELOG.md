# repos

## 0.7.0

### Minor Changes

- [#29](https://github.com/eli0shin/repos/pull/29) [`f09c34b`](https://github.com/eli0shin/repos/commit/f09c34bcb9785482230df15346acb277b5a8747c) Thanks [@eli0shin](https://github.com/eli0shin)! - Make branch argument optional in `repos clean` command - when run from inside a worktree, it now cleans up the current worktree by default.

## 0.6.0

### Minor Changes

- [#27](https://github.com/eli0shin/repos/pull/27) [`bafb326`](https://github.com/eli0shin/repos/commit/bafb326dabd97657b8b827a24b72c639c04ff13f) Thanks [@eli0shin](https://github.com/eli0shin)! - Add stacked diffs workflow with `repos stack` and `repos restack` commands. The `stack` command creates a new worktree branching from the current branch (instead of main), recording the parent-child relationship in config. The `restack` command rebases the current branch on its parent branch, with automatic fallback to the default branch when the parent has been merged or deleted. Stack relationships are stored as an array of `{ parent, child }` objects inside each repo entry, enabling bidirectional lookups.

## 0.5.1

### Patch Changes

- [#23](https://github.com/eli0shin/repos/pull/23) [`5c609e0`](https://github.com/eli0shin/repos/commit/5c609e04ba32d397e52a29844c89be952734f450) Thanks [@eli0shin](https://github.com/eli0shin)! - Fix `repos work` command failing when the branch already exists locally. Now correctly checks out existing local branches instead of attempting to create a new branch with the same name.

## 0.5.0

### Minor Changes

- [#21](https://github.com/eli0shin/repos/pull/21) [`1cc15de`](https://github.com/eli0shin/repos/commit/1cc15deae20bd7e32376a428bd9615007002e83c) Thanks [@eli0shin](https://github.com/eli0shin)! - Add `repos cleanup` command to remove worktrees for branches that have been merged or deleted upstream. Detects regular merges, squash merges, and rebase merges using `git cherry` for accurate content-based comparison.

## 0.4.0

### Minor Changes

- [#19](https://github.com/eli0shin/repos/pull/19) [`4392d1b`](https://github.com/eli0shin/repos/commit/4392d1b2599d45791107487fc9d1c1f1a5bf3f44) Thanks [@eli0shin](https://github.com/eli0shin)! - Add configurable auto-update system that checks for updates in the background on every command (with 24-hour cooldown). Supports three modes: `auto` (silent install), `notify` (show message), and `off` (disabled), configurable via `config.updateBehavior` in repos.json.

## 0.3.3

### Patch Changes

- [#17](https://github.com/eli0shin/repos/pull/17) [`5908411`](https://github.com/eli0shin/repos/commit/5908411e3491cf99f2568adf8fb451603d5d91ad) Thanks [@eli0shin](https://github.com/eli0shin)! - Fix worktree creation to not set upstream tracking to origin/main when creating a new branch that doesn't exist on the remote. New branches now have no tracking until pushed.

## 0.3.2

### Patch Changes

- [#15](https://github.com/eli0shin/repos/pull/15) [`635531c`](https://github.com/eli0shin/repos/commit/635531c19f1982a9c0d375dea1a9e166d081f46e) Thanks [@eli0shin](https://github.com/eli0shin)! - Add `--force` flag to `repos init` command that allows users to update their existing shell configuration when the init script changes, instead of requiring manual config file editing.

- [#15](https://github.com/eli0shin/repos/pull/15) [`635531c`](https://github.com/eli0shin/repos/commit/635531c19f1982a9c0d375dea1a9e166d081f46e) Thanks [@eli0shin](https://github.com/eli0shin)! - Fix bare repository and worktree detection in the adopt command. Bare repos are now correctly identified and adopted with the `bare: true` flag, and worktrees are no longer incorrectly adopted as separate repositories. Also fixes the shell wrapper to properly cd into new worktrees by sending status messages to stderr.

## 0.3.1

### Patch Changes

- [#13](https://github.com/eli0shin/repos/pull/13) [`0660dee`](https://github.com/eli0shin/repos/commit/0660dee2c6cacd4f704c479f00a6b9dabd2a83b3) Thanks [@eli0shin](https://github.com/eli0shin)! - Fix bare repository and worktree detection in the adopt command. Bare repos are now correctly identified and adopted with the `bare: true` flag, and worktrees are no longer incorrectly adopted as separate repositories. Also fixes the shell wrapper to properly cd into new worktrees by sending status messages to stderr.

## 0.3.0

### Minor Changes

- [#11](https://github.com/eli0shin/repos/pull/11) [`ae7bc4a`](https://github.com/eli0shin/repos/commit/ae7bc4a646c5978165c365040bafdc2cda1f2863) Thanks [@eli0shin](https://github.com/eli0shin)! - Add worktree management commands (`work`, `clean`, `rebase`, `init`) and bare repository support. Simplify config by removing per-repo branch tracking.

## 0.2.4

### Patch Changes

- [#8](https://github.com/eli0shin/repos/pull/8) [`67f68eb`](https://github.com/eli0shin/repos/commit/67f68eb0f17025df0ea59faf71cd74d95b022bbd) Thanks [@eli0shin](https://github.com/eli0shin)! - Refactor config and repo location handling to be flexible instead of hardcoded. Config now uses XDG-compliant path (`~/.config/repos/config.json`) with `XDG_CONFIG_HOME` support. Each repo entry stores its absolute path, and commands work relative to the current directory instead of assuming `~/code`.

## 0.2.3

### Patch Changes

- [#6](https://github.com/eli0shin/repos/pull/6) [`da59340`](https://github.com/eli0shin/repos/commit/da593401dd709c9486a503f7405872e2f001a3f1) Thanks [@eli0shin](https://github.com/eli0shin)! - Consolidate release workflow into single job to fix binary publishing. Binaries are now built and uploaded in the same workflow run after changesets creates a release, avoiding GitHub's limitation where GITHUB_TOKEN events don't trigger other workflows.

## 0.2.2

### Patch Changes

- [#4](https://github.com/eli0shin/repos/pull/4) [`544c4bf`](https://github.com/eli0shin/repos/commit/544c4bf36734a312f4c1b314bce8177683147bff) Thanks [@eli0shin](https://github.com/eli0shin)! - Add privatePackages configuration to enable changesets to create git tags for private packages, fixing GitHub release creation in the release workflow.

## 0.2.1

### Patch Changes

- [#2](https://github.com/eli0shin/repos/pull/2) [`7b2cb84`](https://github.com/eli0shin/repos/commit/7b2cb84811811af069d9c47e70b760c375a32cd3) Thanks [@eli0shin](https://github.com/eli0shin)! - Fix release workflow to actually publish binaries to GitHub releases. Split binary building into a separate workflow triggered by release events and use bun cross-compilation from a single Linux runner instead of a matrix build.

## 0.2.0

### Minor Changes

- [`77dab66`](https://github.com/eli0shin/repos/commit/77dab66760609c5b8c24f2bf3dde61c1d3003f84) Thanks [@eli0shin](https://github.com/eli0shin)! - Add GitHub Actions CI/CD workflows and bash install script for distributing the CLI via GitHub releases instead of npm.

- [`77dab66`](https://github.com/eli0shin/repos/commit/77dab66760609c5b8c24f2bf3dde61c1d3003f84) Thanks [@eli0shin](https://github.com/eli0shin)! - Add self-update command that downloads and installs the latest binary from GitHub releases, with platform detection for macOS and Linux.
