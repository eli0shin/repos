---
'repos': major
---

Replace `session` command with `--tmux`/`-t` flag on `work` and `stack` commands. Instead of a separate command for tmux integration, use `repos work -t <branch>` or `repos stack -t <branch>` to create a worktree and open it in a tmux session. The `repos-session` shell helper is also removed.
