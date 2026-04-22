---
'repos': patch
---

Fix `clean -t` and `cleanup -t` disconnecting the tmux client when killing the session it is attached to. `clean -t` now opens the main-worktree session before killing the old one; `cleanup -t` switches the client away (preferring an existing main-worktree session, then `switch-client -l`, then a fresh session) before killing the current session.
