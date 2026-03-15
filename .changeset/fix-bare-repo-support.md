---
'repos': patch
---

Fix bare repo handling in `latest`, `remove`, and `sync` commands. `latest` now fetches bare repos instead of skipping them. `remove --delete` cleans up worktrees before deleting bare repos. `sync` reuses adopt logic so bare repos and worktrees are handled correctly.
