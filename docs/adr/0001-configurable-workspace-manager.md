# Use a configurable Workspace Manager behind the tmux flags

Repos will support tmux and Herdr as Workspace Managers. The global `workspaceManager` setting selects the provider, while the current tmux or Herdr environment takes precedence. An absent setting selects tmux.

The existing `--tmux`, `--no-tmux`, and `--no-focus` flags keep their names and behavior for compatibility. They control the selected Workspace Manager rather than a specific provider. Repos will not add a Herdr-specific flag. Each provider must preserve the existing tmux workflow, except when a provider handles a tmux-specific safety problem itself. For example, Herdr selects another workspace when the active workspace closes, so it does not need tmux's switch-before-kill sequence.

Repos remains the owner of Git worktree creation and removal. Provider integrations only create, find, focus, and close the Managed Workspace for a worktree. The Herdr integration will use Herdr CLI wrappers instead of implementing its raw socket protocol.

## Workspace Manager seam

Commands use two lifecycle operations at the Workspace Manager seam:

- Open a Managed Workspace for a repository, branch, and worktree path, with requested focus.
- Plan closure of one or more Managed Workspaces with preserved, destination, or automatic focus.

Closure uses two phases because Git removes a worktree before its Managed Workspace closes. Planning resolves provider identities from the canonical name and the live worktree path. It also validates focus safety before Git mutation. The returned immutable plan can then preview the captured actions or execute them after the worktree path no longer exists.

The tmux adapter owns session matching, creation, reuse, focus, closure, and safe destination selection. Commands own only Git mutation and their non-workspace output. This keeps tmux process operations and switch-before-kill ordering behind the seam and lets another adapter preserve the same command workflow.
