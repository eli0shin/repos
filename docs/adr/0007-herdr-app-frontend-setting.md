# Drive herdr-frontend when the frontend setting selects it

herdr-frontend serves Herdr app's `ls | do | status` CLI with the same arguments, JSON and exit codes, and keeps its `no Herdr window at` message. Eli's Herdr tools share one setting, the plain text file `herdr/frontend` in herdr-core's config directory (`${XDG_CONFIG_HOME:-$HOME/.config}`, with an empty `XDG_CONFIG_HOME` counted as unset), holding `herdr-app` or `herdr-frontend`. Each tool reads it and calls the selected app itself; there is no shim.

The Herdr app provider reads the file each time it runs the app, and so does the check for a Herdr app terminal, so the selected app's window decides both. It stays the `herdr-app` provider in `workspaceManager`, because the two apps manage the same spaces in the same way and differ only in the binary. A missing, unreadable or unrecognized file selects `herdr-app`, which keeps repos exactly as it was for anyone without the setting.
