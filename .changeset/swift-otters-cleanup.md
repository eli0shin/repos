---
'repos': patch
---

Fix `repos clean` failing with "Directory not empty" when a worktree contains gitignored files (e.g., `node_modules`, build artifacts). `clean` now retries by removing the leftover directory only after `git worktree remove`'s safety checks pass — so locked worktrees and in-progress rebases still block removal. `cleanup` and `remove` use `--force` because they've already established the worktree is disposable.
