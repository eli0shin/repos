---
'repos': major
---

Remove tmux support and make Herdr the default Workspace Manager. `workspaceManager: "tmux"` is no longer valid, and the `TMUX` environment no longer enables workspace management. The `--tmux`, `--no-tmux`, and `--no-focus` flags keep their names.
