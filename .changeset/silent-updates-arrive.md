---
'repos': minor
---

Add configurable auto-update system that checks for updates in the background on every command (with 24-hour cooldown). Supports three modes: `auto` (silent install), `notify` (show message), and `off` (disabled), configurable via `config.updateBehavior` in repos.json.
