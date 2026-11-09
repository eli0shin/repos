# Open Herdr app spaces without focus through herdr-core

Supersedes the `--no-focus` behavior in [ADR 0002](./0002-herdr-app-workspace-manager.md).

The Herdr app's `space.new` always shows the space it opens and has no option to open one in the background ([herdr-app#447](https://github.com/herdrdev/herdr-app/issues/447)). Repos recorded the focused pane and focused it again, but focus still moved to the new space and back. A person typing in another session had keystrokes land in the wrong place, and agents opening worktrees pulled them out of their work several times a day.

The window adopts any herdr-core terminal labeled `herdr.space` and `herdr.tab`, and an id it does not know becomes a new space and tab, without moving focus. So `--no-focus` now starts the space's shell with `hc run --bg --keep --no-parent`, labeled with new ids, waits for the window to list the space, and names it. That shell is the login shell `space.new` would start. This makes `hc` a second dependency of the provider, beside `herdr-app`; both ship with the app. A focused command still uses `space.new`, since it shows the space anyway.
