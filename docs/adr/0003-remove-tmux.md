# Remove tmux and make Herdr the default Workspace Manager

Repos has a single user, who no longer uses tmux. Keeping the tmux provider meant maintaining its session matching, switch-before-kill sequencing, and real-tmux tests, which break with tmux releases. Repos removes tmux entirely, with no compatibility path: `workspaceManager: "tmux"` is now an invalid config, and the `TMUX` environment marker no longer selects or enables anything.

Herdr becomes the default Workspace Manager when no setting or environment selects one. The precedence is now `HERDR_ENV=1`, then a Herdr app terminal, then `workspaceManager`, then Herdr.

The `--tmux`, `--no-tmux`, and `--no-focus` flags keep their names. Renaming them would only churn the shell functions and habits that use them; they already control whichever Workspace Manager is selected.
