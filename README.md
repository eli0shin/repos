# repos

A portable git repository manager.

`repos` helps developers manage multiple git repositories. It's designed for:

- **Multi-machine development** - Track your repos in a config file and clone them anywhere
- **Parallel feature work** - Use git worktrees to work on multiple branches simultaneously
- **Batch operations** - Pull all repos at once, clean up stale worktrees across projects

It simplifies worktree workflows by automatically setting up branch tracking and providing easy rebasing against the default branch.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/eli0shin/repos/main/install.sh | bash
```

## Commands

| Command                        | Description                                          |
| ------------------------------ | ---------------------------------------------------- |
| `repos list`                   | List all tracked repositories                        |
| `repos add <url> [--bare]`     | Clone a repo and add it to tracking                  |
| `repos clone [name]`           | Clone repos from config (all or specific)            |
| `repos remove <name> [-d]`     | Remove a repo from tracking (-d to delete directory) |
| `repos latest`                 | Pull all repos in parallel                           |
| `repos adopt`                  | Add existing repos to config                         |
| `repos sync`                   | Adopt existing + clone missing repos                 |
| `repos update`                 | Update repos CLI to latest version                   |
| `repos work <branch> [repo]`   | Create a worktree for a branch                       |
| `repos stack <branch>`         | Create a stacked worktree from current branch        |
| `repos restack`                | Rebase current branch on its parent branch           |
| `repos unstack`                | Rebase onto default branch and remove stack relation |
| `repos clean <branch> [repo]`  | Remove a worktree (--force for parent branches)      |
| `repos rebase [branch] [repo]` | Rebase worktree branch on default branch             |
| `repos cleanup [--dry-run]`    | Remove worktrees for merged/deleted branches         |
| `repos init`                   | Configure shell for work command                     |
| `work <branch>`                | Create worktree and cd into it (shell function)      |

See [USERGUIDE.md](./USERGUIDE.md) for complete documentation.
