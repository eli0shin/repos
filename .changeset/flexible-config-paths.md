---
'repos': patch
---

Refactor config and repo location handling to be flexible instead of hardcoded. Config now uses XDG-compliant path (`~/.config/repos/config.json`) with `XDG_CONFIG_HOME` support. Each repo entry stores its absolute path, and commands work relative to the current directory instead of assuming `~/code`.
