# repos

## 1.0.0

### Major Changes

- [#58](https://github.com/eli0shin/repos/pull/58) [`7e0410a`](https://github.com/eli0shin/repos/commit/7e0410a3e78c5a68a39f07a85a4f6b9b75e6dd85) Thanks [@eli0shin](https://github.com/eli0shin)! - Replace `session` command with `--tmux`/`-t` flag on `work` and `stack` commands. Instead of a separate command for tmux integration, use `repos work -t <branch>` or `repos stack -t <branch>` to create a worktree and open it in a tmux session. The `repos-session` shell helper is also removed.

### Patch Changes

- [#62](https://github.com/eli0shin/repos/pull/62) [`70d00a4`](https://github.com/eli0shin/repos/commit/70d00a4c7127dab9f6bfb2a9cf18f0bdbf8aa5c2) Thanks [@eli0shin](https://github.com/eli0shin)! - Fix bare repo handling in `latest`, `remove`, and `sync` commands. `latest` now fetches bare repos instead of skipping them. `remove --delete` cleans up worktrees before deleting bare repos. `sync` reuses adopt logic so bare repos and worktrees are handled correctly.

## 0.12.0

### Minor Changes

- [#55](https://github.com/eli0shin/repos/pull/55) [`9af22d6`](https://github.com/eli0shin/repos/commit/9af22d64425546a0d2296bb228c7d13506a49ea0) Thanks [@eli0shin](https://github.com/eli0shin)! - The `work` and `session` commands now automatically record a stack relationship with the default branch when creating new branches, enabling `restack`, `unstack`, `collapse`, and other stack operations on branches created via `work`/`session` (not just via `stack`). Fixes `restack` to correctly handle the parent-is-default-branch case in bare repos.

### Patch Changes

- [#56](https://github.com/eli0shin/repos/pull/56) [`eebd75e`](https://github.com/eli0shin/repos/commit/eebd75e081b16c7b59cdfa877bfb96d86ad84b0a) Thanks [@eli0shin](https://github.com/eli0shin)! - Fix stale fork point detection in restack, rebase, and unstack operations. When a child branch is manually rebased outside the repos tool, the stored base ref becomes stale, causing rebase --onto to select the wrong commit range. refreshBaseRef now validates the stored ref against git merge-base and resyncs when needed, preventing conflicts especially in squash-merge scenarios where cherry detection cannot match individual commits against squashed ones.

## 0.11.1

### Patch Changes

- [#53](https://github.com/eli0shin/repos/pull/53) [`932adc4`](https://github.com/eli0shin/repos/commit/932adc451f884c1d5bb7b451f191008bf3a303b6) Thanks [@eli0shin](https://github.com/eli0shin)! - fix: use @ separator in tmux session names instead of : to avoid tmux interpreting it as a session:window separator

## 0.11.0

### Minor Changes

- [#46](https://github.com/eli0shin/repos/pull/46) [`53d15e6`](https://github.com/eli0shin/repos/commit/53d15e6c87428ed279301339c1fad6092aea7350) Thanks [@eli0shin](https://github.com/eli0shin)! - Add `repos session` command that creates a worktree and opens a tmux session in it, with automatic switch-client when inside tmux or attach when outside.

- [#48](https://github.com/eli0shin/repos/pull/48) [`a1658fa`](https://github.com/eli0shin/repos/commit/a1658fa0a4aefe1fd668c72e186f6d4b862e6b05) Thanks [@eli0shin](https://github.com/eli0shin)! - Add `repos main` command and `work-main` shell function to cd back to the main worktree without cleaning the current one.

### Patch Changes

- [#47](https://github.com/eli0shin/repos/pull/47) [`1163c03`](https://github.com/eli0shin/repos/commit/1163c0370b05b8c067b0333edb10d934ec52d446) Thanks [@eli0shin](https://github.com/eli0shin)! - Fix unstack and rebase to handle squash/rebase-merged parent branches using fork point tracking, preventing conflicts when rebasing after a parent branch has been squash-merged into main.

- [#45](https://github.com/eli0shin/repos/pull/45) [`ec113c0`](https://github.com/eli0shin/repos/commit/ec113c0fd4caad9f9a978cf048af611262919ba5) Thanks [@eli0shin](https://github.com/eli0shin)! - Fix editor freeze in `repos continue` by spawning `git rebase --continue` with inherited stdio, allowing the editor to open normally. Also set `stdin: 'ignore'` on piped git commands to prevent hangs if git unexpectedly invokes an editor.

## 0.10.1

### Patch Changes

- [#42](https://github.com/eli0shin/repos/pull/42) [`de991c7`](https://github.com/eli0shin/repos/commit/de991c7dc491da8b0369cd29f0f5a761d502e483) Thanks [@eli0shin](https://github.com/eli0shin)! - Add a new `work-clean` shell helper (bash/zsh/fish) that forwards to `repos clean` and changes directory using the returned path. Update `repos clean` to emit machine-readable parent-path output on successful non-dry-run cleanup while keeping status messaging on stderr, and make `rebase --continue` non-interactive so conflict-resolution flows complete reliably in tests.

## 0.10.0

### Minor Changes

- [#38](https://github.com/eli0shin/repos/pull/38) [`5d36917`](https://github.com/eli0shin/repos/commit/5d36917b193cfe6a1e300bbd68c1eb29d02c4e07) Thanks [@eli0shin](https://github.com/eli0shin)! - Add recursive restack and continue command

  **Problem**: When stacking branches (a → b → c) and rebasing branch `a` on `main`, the merge-base between `b` and `a` was lost. This caused conflicts when restacking `b` on `a` because git couldn't determine which commits belonged to `b` vs inherited from `a`.

  **Solution**: Store fork points in git refs (`refs/bases/<branch>`) and use `git rebase --onto` to rebase only the commits that belong to the child branch.
  - `restack` now uses `--onto` with stored fork points to avoid false conflicts after parent is rebased
  - `restack` recursively restacks all children branches (use `--only` to limit to current branch)
  - New `continue` command to resume a paused rebase and update fork point tracking
  - Fork points stored in git refs prevent garbage collection of orphan commits (works even after squashing parent)

## 0.9.0

### Minor Changes

- [#35](https://github.com/eli0shin/repos/pull/35) [`c9e063a`](https://github.com/eli0shin/repos/commit/c9e063ac7816883afd3e91538335e7d2e2ae9691) Thanks [@eli0shin](https://github.com/eli0shin)! - Add `--dry-run` flag to `repos squash` command to preview commits that would be squashed without performing the operation. Shows commits to be squashed, the merge-base boundary commit, and all branches containing the merge-base.

### Patch Changes

- [#36](https://github.com/eli0shin/repos/pull/36) [`37e7e14`](https://github.com/eli0shin/repos/commit/37e7e14e142c683ba51324065539acb8833c4239) Thanks [@eli0shin](https://github.com/eli0shin)! - Fix cleanup command to scope to current repo when run inside a tracked repo instead of cleaning all repos

## 0.8.0

### Minor Changes

- [#33](https://github.com/eli0shin/repos/pull/33) [`8599154`](https://github.com/eli0shin/repos/commit/859915486074b151de534dd0fa3d49e5cd90dbef) Thanks [@eli0shin](https://github.com/eli0shin)! - Add `repos squash` command to squash all commits since the base branch into a single commit. Supports `-m` flag for inline message, `-f/--first` flag to use the first commit's message, or opens an editor by default. Works with both regular branches (squashes since default branch) and stacked branches (squashes since parent branch).

## 0.7.1

### Patch Changes

- [#31](https://github.com/eli0shin/repos/pull/31) [`e0d6644`](https://github.com/eli0shin/repos/commit/e0d66443ddc5a55ccf258d66dbbbd5dc8530a63a) Thanks [@eli0shin](https://github.com/eli0shin)! - Fix rebase conflict handling to pause instead of auto-aborting, allowing users to resolve conflicts manually with `git rebase --continue`.

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
