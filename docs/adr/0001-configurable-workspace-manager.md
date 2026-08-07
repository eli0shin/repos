# Use a configurable Workspace Manager behind the tmux flags

Repos will support tmux and Herdr as Workspace Managers. The global `workspaceManager` setting selects the provider, while the current tmux or Herdr environment takes precedence. An absent setting selects tmux.

The existing `--tmux`, `--no-tmux`, and `--no-focus` flags keep their names and behavior for compatibility. They control the selected Workspace Manager rather than a specific provider. Repos will not add a Herdr-specific flag. Each provider must preserve the existing tmux workflow, except when a provider handles a tmux-specific safety problem itself. For example, Herdr selects another workspace when the active workspace closes, so it does not need tmux's switch-before-kill sequence.

Repos remains the owner of Git worktree creation and removal. Provider integrations only create, find, focus, and close the Managed Workspace for a worktree. The Herdr integration will use Herdr CLI wrappers instead of implementing its raw socket protocol.
