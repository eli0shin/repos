---
'repos': patch
---

Identify the main worktree's tmux session by name (`repo@main` or bare `repo`) with a fallback to matching by working directory, so `clean -t` and `session` reuse an existing session instead of creating a duplicate.
