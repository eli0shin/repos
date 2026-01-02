# repos

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
