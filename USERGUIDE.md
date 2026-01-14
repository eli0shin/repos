# repos User Guide

Complete documentation for the repos CLI - a portable git repository manager.

## Table of Contents

- [Introduction](#introduction)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Commands Reference](#commands-reference)
  - [Repository Management](#repository-management)
  - [Worktree Management](#worktree-management)
  - [CLI Maintenance](#cli-maintenance)
- [Configuration](#configuration)
- [Workflows](#workflows)
- [Troubleshooting](#troubleshooting)

## Introduction

`repos` helps developers manage multiple git repositories. It's designed for:

- **Multi-machine development** - Track your repos in a config file and clone them anywhere
- **Parallel feature work** - Use git worktrees to work on multiple branches simultaneously
- **Batch operations** - Pull all repos at once, clean up stale worktrees across projects

### What repos does

1. **Tracks repositories** in `~/.config/repos/config.json`
2. **Clones repositories** from config to new machines
3. **Manages git worktrees** for branch-based development
4. **Batch operations** across all tracked repos

## Installation

### Quick Install (macOS/Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/eli0shin/repos/main/install.sh | bash
```

This downloads the binary for your platform and adds it to your PATH.

### Manual Installation

1. Download the binary for your platform from [GitHub Releases](https://github.com/eli0shin/repos/releases)
2. Make it executable: `chmod +x repos`
3. Move it to your PATH: `mv repos /usr/local/bin/`

### Verify Installation

```bash
repos --version
```

## Quick Start

### Track existing repositories

```bash
cd ~/code
repos adopt
```

This scans the directory for git repositories and adds them to your config.

### Set up on a new machine

```bash
# Copy your config file from another machine, then:
repos clone
```

### Pull all repositories

```bash
repos latest
```

### Start using worktrees

```bash
# One-time shell setup
repos init

# From inside a tracked repo
cd ~/code/my-project
work feature-branch

# You're now in ~/code/my-project-feature-branch
```

## Core Concepts

### The Config File

repos stores all tracked repositories in `~/.config/repos/config.json`. This file is portable - copy it between machines to maintain the same repository setup.

### Regular vs Bare Repositories

- **Regular repositories** have a working directory with your files
- **Bare repositories** contain only git data (no working directory)

Use bare repositories when you primarily work with worktrees. The bare repo stores git history while worktrees provide working directories for each branch.

### Git Worktrees

Git worktrees let you check out multiple branches simultaneously in different directories. Instead of:

```bash
git stash
git checkout feature-branch
# work
git checkout main
git stash pop
```

You can:

```bash
work feature-branch
# Now ~/code/project-feature-branch exists alongside ~/code/project
```

repos creates worktrees in a sibling directory with the branch name appended.

## Commands Reference

### Repository Management

---

#### `repos list`

Lists all tracked repositories with their status.

```bash
repos list
```

**Output includes:**

- Repository name
- Clone status: ✓ (cloned) or ✗ (missing)
- `[bare]` indicator for bare repositories
- Worktrees associated with the repository

**Example output:**

```
Tracked repositories:

  api-server ✓
    /Users/you/code/api-server
      ↳ feature-auth: /Users/you/code/api-server-feature-auth
      ↳ bugfix-login: /Users/you/code/api-server-bugfix-login

  frontend ✓ [bare]
    /Users/you/code/frontend

  docs ✗
    Not cloned
```

---

#### `repos add <url> [--bare]`

Clone a repository and add it to tracking.

```bash
repos add https://github.com/user/repo.git
repos add git@github.com:user/repo.git
repos add https://github.com/user/repo.git --bare
```

**Arguments:**

- `<url>` (required) - Git repository URL (HTTPS or SSH)

**Options:**

- `--bare` - Clone as a bare repository

**Behavior:**

- Extracts repository name from URL automatically
- Clones into current directory
- Adds entry to config file
- Fails if repository name is already tracked

**URL formats supported:**

- `https://github.com/user/repo.git`
- `https://github.com/user/repo`
- `git@github.com:user/repo.git`
- `git@github.com:user/repo`

---

#### `repos clone [name]`

Clone repositories from your config.

```bash
repos clone           # Clone all missing repos
repos clone my-repo   # Clone specific repo
```

**Arguments:**

- `[name]` (optional) - Specific repository name to clone

**Behavior:**

- Skips repositories that already exist locally
- Handles both regular and bare clones based on config
- Reports success/skip status for each repository

---

#### `repos remove <name> [-d, --delete]`

Remove a repository from tracking.

```bash
repos remove my-repo           # Remove from config only
repos remove my-repo -d        # Also delete directory
repos remove my-repo --delete  # Also delete directory
```

**Arguments:**

- `<name>` (required) - Repository name to remove

**Options:**

- `-d, --delete` - Also delete the local directory

**Behavior:**

- Removes entry from config file
- Optionally deletes directory if it exists
- Fails if repository is not in config

---

#### `repos latest`

Pull latest changes for all tracked repositories in parallel.

```bash
repos latest
```

**Behavior:**

- Pulls current branch in each repository
- Runs in parallel for speed
- Reports status for each repository

**Status indicators:**

- `✓ repo-name: updated` - Successfully pulled changes
- `✓ repo-name: up to date` - Already at latest
- `✗ repo-name: not cloned` - Repository doesn't exist locally
- `✗ repo-name: failed` - Pull failed (conflicts, etc.)

**Example output:**

```
Pulling 4 repo(s) in parallel...

  ✓ api-server: updated
  ✓ frontend: up to date
  ✓ docs: up to date
  ✗ legacy-app: not cloned

Pulled 3 repo(s), 1 failed
```

---

#### `repos adopt`

Add existing git repositories to tracking.

```bash
# Inside a git repository
repos adopt

# Inside a directory containing git repos
cd ~/code
repos adopt
```

**Behavior when inside a git repo:**

- Adopts just that repository

**Behavior when inside a directory:**

- Scans for all git repositories
- Excludes worktrees that belong to bare repositories
- Detects remote URLs automatically
- Identifies both regular and bare repositories
- Reports which repos were adopted

**Example output:**

```
Scanning for repos...

  ✓ adopted api-server
  ✓ adopted frontend
  - already tracked: docs
  - skipped api-server-feature (worktree of api-server)

Adopted 2 repo(s)
```

---

#### `repos sync`

Adopt existing repositories and clone missing ones.

```bash
cd ~/code
repos sync
```

**Behavior:**

1. Scans current directory for untracked git repos
2. Adds them to config (like `repos adopt`)
3. Clones any configured repos not in current directory

**Example output:**

```
Scanning for untracked repos...

  ✓ adopted local-project

Cloning missing repos...

  Cloning cloud-service...
  ✓ cloned cloud-service

Sync complete: adopted 1, cloned 1
```

---

### Worktree Management

---

#### `repos init [--print] [--force]`

Configure your shell for the `work` command.

```bash
repos init          # Install shell function
repos init --print  # Print function without installing
repos init --force  # Update existing configuration
```

**Options:**

- `--print` - Output shell function to stdout (don't modify shell config)
- `--force` - Update existing configuration if present

**Supported shells:**

- bash (modifies `~/.bashrc` or `~/.bash_profile`)
- zsh (modifies `~/.zshrc`)
- fish (modifies `~/.config/fish/config.fish`)

**What it installs:**

For bash/zsh:

```bash
work() {
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

For fish:

```fish
function work
  set -l path (repos work $argv)
  set -l exit_code $status
  if test $exit_code -eq 0; and test -d "$path"
    cd $path
  else
    return $exit_code
  end
end
```

After installation, restart your shell or run `source ~/.zshrc` (or equivalent).

---

#### `repos work <branch> [repo-name]`

Create or navigate to a worktree for a branch.

```bash
repos work feature-x              # Inside a tracked repo
repos work feature-x my-repo      # Specify repo explicitly
```

**Arguments:**

- `<branch>` (required) - Branch name for the worktree
- `[repo-name]` (optional) - Repository name. Auto-detected if inside a tracked repo.

**Branch handling:**

- **Local branch exists** - Creates worktree with existing branch
- **Remote branch exists** - Creates local tracking branch from remote
- **Neither exists** - Creates new branch from default branch (main/master)

**Worktree location:**
Worktrees are created as siblings to the main repository:

```
~/code/my-repo/              # Main repository
~/code/my-repo-feature-x/    # Worktree for feature-x
~/code/my-repo-bugfix-y/     # Worktree for bugfix-y
```

**Branch name handling:**
Slashes in branch names are converted to dashes:

- `feature/auth` → `my-repo-feature-auth`
- `bugfix/login-issue` → `my-repo-bugfix-login-issue`

**Output:**
Prints the worktree path to stdout. Use with the `work` shell function to automatically `cd` into it.

---

#### `work <branch>` (Shell Function)

Create worktree and change directory into it.

```bash
cd ~/code/my-project
work feature-auth
# Now in ~/code/my-project-feature-auth
```

**Prerequisite:** Run `repos init` first to install the shell function.

This is a convenience wrapper around `repos work` that automatically `cd`s into the created worktree.

---

#### `repos stack <branch>`

Create a stacked worktree from the current branch.

```bash
repos stack feature-part-2    # Inside a worktree
```

**Arguments:**

- `<branch>` (required) - New branch name for the stacked worktree

**Prerequisites:**

- Must be run from inside an existing worktree (not the bare repo or main checkout)

**Behavior:**

1. Detects the current branch from your working directory
2. Creates a new worktree with a new branch based on the current branch
3. Records the parent-child relationship in your config file

**Use case:**
When working on a feature that depends on another in-progress feature, stack branches to maintain the dependency chain.

**Example:**

```bash
cd ~/code/my-project-feature-auth
work feature-auth              # Working on auth feature
# ... make commits ...

repos stack feature-profile    # Stack profile feature on top of auth
# Now ~/code/my-project-feature-profile exists, based on feature-auth
```

**Output:**
Prints the worktree path to stdout.

---

#### `repos restack [--only]`

Rebase stacked branches on their parent branches.

```bash
repos restack         # Restack current branch and all children (default)
repos restack --only  # Restack only the current branch
```

**Prerequisites:**

- Must be run from inside a worktree that was created with `repos stack`

**Options:**

- `--only` - Only restack the current branch, not its children

**Behavior:**

1. Looks up the parent branch from your config
2. If parent worktree still exists: rebases on the local parent branch
3. If parent is gone (merged/deleted): automatically falls back to default branch and removes the stale parent relationship from config
4. By default, recursively restacks all child branches after the current branch

**Fork point tracking:**
When you create a stacked branch with `repos stack`, the CLI records the exact commit where the child branched off (stored as a git ref `refs/bases/<branch>`). This enables correct rebasing even when the parent branch is squashed or amended - only the child's unique commits are replayed.

**Use case:**
After making new commits on a parent branch (or squashing/amending it), sync child branches to include those changes.

**Example:**

```bash
# Parent branch got new commits
cd ~/code/my-project-feature-profile
repos restack
# feature-profile is now rebased on latest feature-auth
# Any children of feature-profile are also rebased
```

**Restacking only the current branch:**

```bash
repos restack --only
# Only restacks current branch, children are not affected
```

**On conflicts:**
When conflicts occur, the restack pauses. Use `repos continue` after resolving conflicts to complete the restack (see below).

**Auto-fallback:**
When the parent branch no longer exists (worktree removed after merge), `restack` automatically:

1. Detects the parent is gone
2. Falls back to rebasing on `origin/<default-branch>`
3. Removes the stale parent relationship from config

---

#### `repos continue`

Continue a restack operation after resolving conflicts.

```bash
repos continue    # Inside a worktree with a paused rebase
```

**Prerequisites:**

- Must be run from inside a worktree where `repos restack` encountered conflicts
- All conflicts must be resolved and staged

**Behavior:**

1. Runs `git rebase --continue` to complete the rebase
2. Updates the fork point ref to the new parent HEAD
3. If recursive restacking was in progress, continues restacking child branches

**Use case:**
When `repos restack` encounters merge conflicts, it pauses and lets you resolve them. After resolving and staging the files, use `repos continue` to complete the operation.

**Example:**

```bash
cd ~/code/my-project-feature-profile
repos restack
# Error: Rebase conflicts in file.ts

# Resolve conflicts in your editor
git add file.ts
repos continue
# Restack completes, fork point is updated
```

**Why not just `git rebase --continue`?**
Using `repos continue` ensures the fork point ref is updated correctly. If you use raw `git rebase --continue`, the fork point will be stale and future restacks may not work correctly.

---

#### `repos unstack`

Intentionally unstack a branch - rebase it onto the default branch and remove its stack relationship.

```bash
repos unstack    # Inside a stacked worktree
```

**Prerequisites:**

- Must be run from inside a stacked worktree
- Branch must have a recorded parent relationship

**Behavior:**

1. Rebases current branch onto `origin/<default-branch>`
2. Removes the stack entry from config
3. Branch becomes independent (no longer stacked)

**Use cases:**

- When you want to make a stacked branch independent before the parent is merged
- When you decide a feature should be based on main instead of another feature
- When you want to submit a PR directly to main rather than the parent branch

**Example:**

```bash
# You have feature-b stacked on feature-a
cd ~/code/my-project-feature-b
repos unstack
# feature-b is now rebased on main and independent
```

---

#### `repos collapse`

Collapse parent branch into current stacked branch.

```bash
repos collapse    # Inside a stacked worktree
```

**Prerequisites:**

- Must be run from inside a stacked worktree (a branch created with `repos stack`)
- Parent branch must have no other children (siblings must be collapsed/unstacked first)
- Parent worktree must have no uncommitted changes

**Behavior:**

1. Rebases current branch onto grandparent (or default branch if no grandparent)
2. Removes the parent worktree automatically
3. Updates config to reparent current branch to grandparent

**Use cases:**

- After a stacked PR is approved, collapse it to prepare the child for final merge
- Combine multiple stacked diffs into a single branch for merging
- Simplify a deep stack by collapsing intermediate layers

**Example:**

```bash
# You have: main → feature-auth → feature-profile
cd ~/code/api-server-feature-profile
repos collapse
# Result: main → feature-profile (feature-auth worktree removed)
# feature-profile now contains all commits from feature-auth
```

**Multi-level stacks:**

```bash
# You have: main → A → B → C
cd ~/code/api-server-branch-c
repos collapse
# Result: main → A → C (B worktree removed, C now based on A)
```

**Safety checks:**

- Blocks if parent has uncommitted changes
- Blocks if parent has sibling children (other branches stacked on it)
- Parent worktree must exist

---

#### `repos squash [-m, --message <message>] [-f, --first] [--dry-run]`

Squash all commits since the base branch into a single commit.

```bash
repos squash                    # Opens editor for commit message
repos squash -m "Add feature"   # Use provided message
repos squash --first            # Use first commit's message
repos squash -f                 # Short form of --first
repos squash --dry-run          # Preview what would be squashed
```

**Options:**

- `-m, --message <message>` - Commit message for the squashed commit
- `-f, --first` - Use the first commit's message as the squash commit message
- `--dry-run` - Preview commits that would be squashed without performing the squash

**Base branch determination:**

- **Stacked branches** - Uses the parent branch as base (from `repos stack`)
- **Non-stacked branches** - Uses `origin/<default-branch>` as base

**Prerequisites:**

- Must be inside a tracked repo or worktree
- Working directory must be clean (no uncommitted changes)
- At least 2 commits since base branch (single commit = nothing to squash)

**Behavior:**

1. Determines the base branch (parent for stacked, default branch otherwise)
2. Counts commits since base
3. Soft resets to base, keeping all changes staged
4. Creates a single new commit with the squashed changes

**Use cases:**

- Clean up work-in-progress commits before creating a PR
- Combine multiple small commits into a single logical change
- Prepare a stacked branch for merge after parent is merged

**Example:**

```bash
# You have 5 WIP commits on feature branch
cd ~/code/api-server-feature-auth
git log --oneline
# abc1234 WIP: fix tests
# def5678 WIP: add validation
# ghi9012 WIP: initial attempt
# jkl3456 Add auth endpoint
# mno7890 Setup auth module

repos squash -m "Add user authentication"
# All 5 commits are now squashed into one

git log --oneline
# xyz9999 Add user authentication
```

**With stacked branches:**

```bash
# feature-profile is stacked on feature-auth
cd ~/code/api-server-feature-profile
repos squash -m "Add user profile endpoint"
# Squashes commits since feature-auth (not since main)
```

**Using first commit message:**

```bash
repos squash --first
# Uses the message from your first commit after the base
# Useful when your first commit has a good descriptive message
```

**Previewing with dry-run:**

```bash
repos squash --dry-run
# Shows what would be squashed without making changes
```

**Example dry-run output:**

```
Squashing commits since "main"...
Found 3 commits to squash.

Dry run: 3 commit(s) would be squashed

Commits to be squashed:
  ghi9012 Add logout endpoint (Bob, 3 hours ago)
  def5678 Add login endpoint (Alice, 1 day ago)
  abc1234 Add user authentication (Alice, 2 days ago)

Merge base (boundary commit):
  xyz7890 Initial commit
  Base ref: origin/main

Branches containing merge-base:
  main
  feature-other
```

---

#### `repos clean <branch> [repo-name]`

Remove a worktree.

```bash
repos clean feature-x              # Inside a tracked repo
repos clean feature-x my-repo      # Specify repo explicitly
repos clean parent --force         # Force remove parent with stacked children
```

**Arguments:**

- `<branch>` (required) - Branch name of the worktree to remove
- `[repo-name]` (optional) - Repository name. Auto-detected if inside a tracked repo.

**Options:**

- `--force` - Force removal even if the branch has stacked children

**Safety checks:**

- Cannot remove the main worktree
- Blocks removal if uncommitted changes exist
- Blocks removal if branch has stacked children (use `--force` to override)

**Stacked children:**

When cleaning a branch that has stacked children, the command will fail by default:

```
Error: Branch "parent" has stacked children: child-1, child-2
Use --force to remove anyway (children will become independent).
```

Using `--force` removes the parent worktree and makes child branches independent (removes their stack entries).

**Example error:**

```
Error: Cannot remove worktree with uncommitted changes
```

---

#### `repos rebase [branch] [repo-name]`

Rebase a worktree branch on the default branch.

```bash
repos rebase feature-x my-repo     # Specify branch and repo
repos rebase feature-x             # Inside repo, specify branch
repos rebase                       # Inside worktree, auto-detect
```

**Arguments:**

- `[branch]` (optional) - Branch to rebase. Auto-detected if inside a worktree.
- `[repo-name]` (optional) - Repository name. Auto-detected if inside a tracked repo.

**Behavior:**

1. Fetches latest from origin
2. Detects default branch (main, master, etc.)
3. Rebases the specified branch onto default branch

**On conflicts:**
Rebase is aborted and an error is reported. Resolve conflicts manually or use `git rebase --abort`.

---

#### `repos cleanup [--dry-run]`

Remove worktrees for branches that are merged or deleted on remote.

```bash
repos cleanup           # Remove stale worktrees
repos cleanup --dry-run # Preview without removing
```

**Options:**

- `--dry-run` - Show what would be removed without actually removing

**A worktree is cleaned up if:**

1. The remote branch was deleted (upstream gone), OR
2. The branch is fully merged into the default branch

**Merge detection:**
Uses content-based comparison (`git cherry`) to detect merges. Works with:

- Regular merges
- Squash merges
- Rebase merges
- Cherry-picks

**Safety:**

- Skips worktrees with uncommitted changes (reports them)
- Never removes the main worktree

**Example output:**

```
Fetching all repositories...

Checking worktrees...

  Removed api-server/feature-auth (merged)
  Removed api-server/old-experiment (upstream deleted)
  Skipped frontend/wip-feature: uncommitted changes (merged)

Removed 2 worktree(s) (1 merged, 1 upstream deleted)
Skipped 1 worktree(s) with uncommitted changes
```

---

### CLI Maintenance

---

#### `repos update`

Update repos CLI to the latest version.

```bash
repos update
```

**Behavior:**

- Checks GitHub releases for latest version
- Compares with current version
- Downloads and installs if update available
- Reports if already on latest

---

#### `repos -v, --version`

Display current version.

```bash
repos --version
repos -v
```

---

## Configuration

### Config File Location

```
~/.config/repos/config.json
```

If `XDG_CONFIG_HOME` is set, uses `$XDG_CONFIG_HOME/repos/config.json` instead.

### Config File Format

```json
{
  "repos": [
    {
      "name": "api-server",
      "url": "https://github.com/myorg/api-server.git",
      "path": "/Users/you/code/api-server",
      "bare": false,
      "stacks": [{ "parent": "feature-auth", "child": "feature-profile" }]
    },
    {
      "name": "frontend",
      "url": "git@github.com:myorg/frontend.git",
      "path": "/Users/you/code/frontend",
      "bare": true
    }
  ],
  "config": {
    "updateBehavior": "auto",
    "updateCheckIntervalHours": 24
  }
}
```

### Repository Entry Fields

| Field  | Type    | Required | Description                           |
| ------ | ------- | -------- | ------------------------------------- |
| `name` | string  | Yes      | Unique repository identifier          |
| `url`  | string  | Yes      | Git remote URL (HTTPS or SSH)         |
| `path` | string  | Yes      | Absolute filesystem path              |
| `bare` | boolean | No       | Whether repo is bare (default: false) |

### Global Settings

| Setting                    | Type   | Default | Description                                               |
| -------------------------- | ------ | ------- | --------------------------------------------------------- |
| `updateBehavior`           | string | `auto`  | `auto`: auto-install, `notify`: warn only, `off`: disable |
| `updateCheckIntervalHours` | number | `24`    | Hours between update checks                               |

### Stacks

The `stacks` field inside each repo entry tracks parent-child relationships between stacked branches. It's automatically managed by `repos stack` and `repos restack` commands.

```json
"stacks": [
  { "parent": "feature-auth", "child": "feature-profile" },
  { "parent": "feature-profile", "child": "feature-settings" }
]
```

- Created when you run `repos stack`
- Used by `repos restack` to determine rebase target
- Enables bidirectional lookups: find parent of a child, or find all children of a parent
- Cleaned up when parent branch is gone or worktree is removed with `repos clean`

### Fork Point Refs

In addition to the config file, repos stores fork point information as git refs in `refs/bases/<branch>`. These refs track the exact commit where a child branch was created from its parent.

**Why fork points matter:**
When you squash or amend commits on a parent branch, the original commits become orphaned. Without fork point tracking, `git rebase` would try to replay commits that are now part of the parent's history, causing conflicts.

**How it works:**

1. When you run `repos stack child-branch`, repos stores the parent's current HEAD as `refs/bases/child-branch`
2. When you run `repos restack`, repos uses `git rebase --onto <parent> <fork-point>` to replay only the child's unique commits
3. After a successful restack, the fork point is updated to the parent's new HEAD

**Inspecting fork points:**

```bash
# View fork point for a branch
git show-ref refs/bases/feature-profile

# View the commit
git log -1 refs/bases/feature-profile
```

**Fork points are:**

- Created by `repos stack`
- Updated by `repos restack` and `repos continue`
- Deleted by `repos clean`, `repos unstack`, and `repos collapse`
- Stored in the git repository (not the config file), so they survive garbage collection

### Editing Config Manually

You can edit the config file directly. repos will pick up changes on next command. Make sure to use absolute paths and valid JSON.

## Workflows

### New Machine Setup

**Option A: Restore from existing config**

```bash
# Install repos
curl -fsSL https://raw.githubusercontent.com/eli0shin/repos/main/install.sh | bash

# Copy config from backup/other machine
mkdir -p ~/.config/repos
cp /path/to/backup/config.json ~/.config/repos/

# Clone all repositories
cd ~/code
repos clone
```

**Option B: Start fresh**

```bash
# Install repos
curl -fsSL https://raw.githubusercontent.com/eli0shin/repos/main/install.sh | bash

# Add repositories manually
cd ~/code
repos add git@github.com:myorg/project1.git
repos add git@github.com:myorg/project2.git

# Or adopt existing repos
repos adopt
```

### Daily Development Workflow

```bash
# Morning: pull all updates
repos latest

# Start feature work
cd ~/code/api-server
work feature-new-endpoint

# Work on the feature...
# Main branch still available at ~/code/api-server

# Need to review a PR? Create another worktree
work pr-review-123

# End of day: clean up merged branches
repos cleanup
```

### Worktree-First Development

For heavy use of worktrees, use bare repositories:

```bash
# Clone as bare
repos add git@github.com:myorg/big-monorepo.git --bare

# The bare repo has no working directory
cd ~/code/big-monorepo
ls  # Shows git internal files only

# Create worktree for main branch
work main
# Now ~/code/big-monorepo-main has your files

# Create feature worktree
work feature-x
# ~/code/big-monorepo-feature-x

# List all worktrees
repos list
```

### Team Synchronization

Share your config with teammates:

```bash
# Export config
cp ~/.config/repos/config.json ./team-repos.json
# Commit to team wiki/docs

# Teammate imports
cp team-repos.json ~/.config/repos/config.json
repos clone
```

### Keeping Config in Sync

Back up your config to dotfiles:

```bash
# In your dotfiles repo
ln -s ~/.config/repos/config.json ~/dotfiles/repos-config.json

# Or copy periodically
cp ~/.config/repos/config.json ~/dotfiles/
```

### Stacked Diffs Workflow

Use stacked branches when a feature depends on another in-progress feature:

```bash
# Start with a feature branch
cd ~/code/api-server
work feature-auth
# ... implement auth, make commits ...

# Stack a dependent feature on top
repos stack feature-profile
# Now in ~/code/api-server-feature-profile, based on feature-auth

# ... implement profile feature ...

# When auth gets new commits, sync profile
cd ~/code/api-server-feature-profile
repos restack
# profile is now rebased on latest auth

# After auth PR is approved, collapse the stack
repos collapse
# auth worktree is removed, profile now based on main with all auth commits
```

**Alternative: Automatic fallback when parent is merged**

```bash
# If auth is merged and its worktree is cleaned up
repos restack
# Automatically detects auth is gone, rebases on main instead
```

**Benefits:**

- Work on dependent features without waiting for PR merges
- Keep child branches in sync with parent changes
- Collapse stacks to prepare for final merge
- Automatic fallback when parent branches are merged

**Tips:**

- Create separate PRs for each branch in the stack
- Restack after making changes to parent branches
- Use `repos collapse` after a parent PR is approved to prepare child for merge
- Use `repos cleanup` to remove merged stacked branches

## Troubleshooting

### "Repository not found" when running commands

Make sure you're inside a tracked repository or specify the repo name:

```bash
# Check tracked repos
repos list

# Specify repo explicitly
repos work feature-x my-repo
```

### "Cannot create worktree" errors

Check that:

1. The repository is cloned
2. No worktree exists for that branch already
3. The branch name is valid

```bash
# List existing worktrees
git -C /path/to/repo worktree list
```

### Worktree has uncommitted changes

`repos cleanup` and `repos clean` won't remove worktrees with uncommitted changes:

```bash
cd ~/code/my-repo-feature-x
git status  # Check what's uncommitted
git stash   # or commit changes
repos clean feature-x
```

### Config file location issues

If repos can't find your config:

```bash
# Check XDG_CONFIG_HOME
echo $XDG_CONFIG_HOME

# Config should be at:
ls ~/.config/repos/config.json
# or
ls $XDG_CONFIG_HOME/repos/config.json
```

### Shell function not working

After `repos init`, restart your shell:

```bash
exec $SHELL
# or
source ~/.zshrc  # for zsh
source ~/.bashrc # for bash
```

### Rebase conflicts

When `repos rebase` fails due to conflicts:

```bash
cd ~/code/my-repo-feature-x
git status           # See conflicting files
git rebase --abort   # Cancel and return to previous state
# or resolve conflicts manually
```

### Restack conflicts

When `repos restack` fails due to conflicts:

```bash
cd ~/code/my-repo-feature-x
git status           # See conflicting files

# Option 1: Resolve and continue
# Edit conflicting files to resolve
git add <resolved-files>
repos continue       # Complete the restack (updates fork point)

# Option 2: Abort
git rebase --abort   # Cancel and return to previous state
```

**Important:** Always use `repos continue` instead of `git rebase --continue` when restacking. This ensures the fork point ref is updated correctly for future restacks.

### Update check disabled

If auto-update isn't working:

```bash
# Check config
cat ~/.config/repos/config.json | grep updateBehavior

# Set to auto
# Edit config and change "updateBehavior": "auto"
```

---

## Command Quick Reference

| Command                              | Description                                 |
| ------------------------------------ | ------------------------------------------- |
| `repos list`                         | List tracked repos and worktrees            |
| `repos add <url> [--bare]`           | Clone and track a repository                |
| `repos clone [name]`                 | Clone repos from config                     |
| `repos remove <name> [-d]`           | Remove repo from tracking                   |
| `repos latest`                       | Pull all repos in parallel                  |
| `repos adopt`                        | Add existing repos to config                |
| `repos sync`                         | Adopt + clone missing repos                 |
| `repos init [--print] [--force]`     | Set up shell for work command               |
| `repos work <branch> [repo]`         | Create worktree for branch                  |
| `repos stack <branch>`               | Create stacked worktree from current branch |
| `repos restack [--only]`             | Rebase stacked branch(es) on parent         |
| `repos continue`                     | Continue restack after resolving conflicts  |
| `repos unstack`                      | Unstack branch onto default branch          |
| `repos collapse`                     | Collapse parent into current stacked branch |
| `repos squash [-m] [-f] [--dry-run]` | Squash commits since base into one commit   |
| `repos clean <branch> [repo]`        | Remove a worktree (--force for parents)     |
| `repos rebase [branch] [repo]`       | Rebase worktree on default branch           |
| `repos cleanup [--dry-run]`          | Remove merged/deleted worktrees             |
| `repos update`                       | Update CLI to latest version                |
| `repos -v`                           | Show version                                |
| `work <branch>`                      | Create worktree and cd into it (shell fn)   |
