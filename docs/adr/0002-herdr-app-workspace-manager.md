# Add the Herdr app as a third Workspace Manager

The Herdr desktop app is a separate product from Herdr. Its terminals run in herdr-core (`hc`), and the `herdr-app` CLI arranges them in spaces and tabs in the open window. Herdr's `HERDR_ENV` is not set in its terminals, so repos treated them as unmanaged and fell back to tmux. Repos adds `herdr-app` as a provider rather than extending the Herdr adapter, because the two products share no CLI, identifiers, or environment markers.

A terminal is a Herdr app terminal when `HC_TERMINAL_ID` is set and the open Herdr window on this computer lists that terminal in a local space. The marker alone is not enough: herdr-core also runs terminals on machines the app reaches over SSH, and those carry the same markers and may have their own `herdr-app` and window. Such terminals, terminals without a space, and terminals whose window is closed stay unmanaged. Herdr and tmux keep precedence, so the innermost environment still wins when either runs inside an app terminal.

A Managed Workspace is a local space whose folder is the worktree. The provider drives only the window's commands (`ls`, `status`, and `do space.new`, `space.select`, `space.rename`, `space.close`, `pane.focus`); it never talks to herdr-core. The app shows every new space and has no option to create one in the background, so `--no-focus` records the focused pane and focuses it again.

Repos does not open the window. Launching and waiting for a desktop app is outside what a worktree command should do, so the person opens it. When `workspaceManager` selects the Herdr app and its window is closed, opening fails with a clear error, and closure warns and closes nothing while Git worktree removal still proceeds.
