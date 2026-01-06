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

#### `repos clean <branch> [repo-name]`

Remove a worktree.

```bash
repos clean feature-x              # Inside a tracked repo
repos clean feature-x my-repo      # Specify repo explicitly
```

**Arguments:**

- `<branch>` (required) - Branch name of the worktree to remove
- `[repo-name]` (optional) - Repository name. Auto-detected if inside a tracked repo.

**Safety checks:**

- Cannot remove the main worktree
- Blocks removal if uncommitted changes exist

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
      "bare": false
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

| Command                          | Description                               |
| -------------------------------- | ----------------------------------------- |
| `repos list`                     | List tracked repos and worktrees          |
| `repos add <url> [--bare]`       | Clone and track a repository              |
| `repos clone [name]`             | Clone repos from config                   |
| `repos remove <name> [-d]`       | Remove repo from tracking                 |
| `repos latest`                   | Pull all repos in parallel                |
| `repos adopt`                    | Add existing repos to config              |
| `repos sync`                     | Adopt + clone missing repos               |
| `repos init [--print] [--force]` | Set up shell for work command             |
| `repos work <branch> [repo]`     | Create worktree for branch                |
| `repos clean <branch> [repo]`    | Remove a worktree                         |
| `repos rebase [branch] [repo]`   | Rebase worktree on default branch         |
| `repos cleanup [--dry-run]`      | Remove merged/deleted worktrees           |
| `repos update`                   | Update CLI to latest version              |
| `repos -v`                       | Show version                              |
| `work <branch>`                  | Create worktree and cd into it (shell fn) |
