# Select the Herdr app before Herdr

A Herdr app terminal now takes precedence over `HERDR_ENV=1`. The precedence is a Herdr app terminal, then `HERDR_ENV=1`, then `workspaceManager`, then Herdr.

Herdr runs in a terminal, so herdr-core is easily started from a Herdr pane. herdr-core then passes Herdr's `HERDR_ENV` and pane markers to every Herdr app terminal it runs, and repos opened Herdr workspaces from inside the app. A Herdr app terminal is identified by the open window on this computer showing its `HC_TERMINAL_ID`, which a stale inherited marker cannot satisfy, so checking it first is reliable. Herdr running inside an app terminal now also selects the Herdr app; that nesting is rarer than the leak it replaces.
