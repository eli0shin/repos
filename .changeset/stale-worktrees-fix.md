---
'repos': patch
---

Fix `repos cleanup` crashing when worktree directories have been manually deleted by pruning stale git worktree references before listing and handling missing-directory errors in git command execution.
