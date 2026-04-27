---
'repos': patch
---

Fix `repos clean` failing with "Directory not empty" when a worktree contains gitignored files (e.g., `node_modules`, build artifacts) by passing `--force` to `git worktree remove`.
