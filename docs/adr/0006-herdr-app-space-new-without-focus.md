# Open Herdr app spaces without focus through `space.new`

Supersedes [ADR 0005](./0005-herdr-app-spaces-without-focus.md).

Herdr app 0.1.16 added `focus: false` to `space.new`, which adds a space without showing it or moving focus ([herdr-app#447](https://github.com/herdrdev/herdr-app/issues/447)). `--no-focus` now uses it. Repos no longer starts the space's shell through herdr-core (`hc`), waits for the window to adopt it, or names it afterwards, so the provider depends on `herdr-app` alone again. An older app refuses the argument, and the command fails with its error. There is no fallback to herdr-core, because Herdr updates itself.
