---
'repos': minor
---

Add `repos cleanup` command to remove worktrees for branches that have been merged or deleted upstream. Detects regular merges, squash merges, and rebase merges using `git cherry` for accurate content-based comparison.
