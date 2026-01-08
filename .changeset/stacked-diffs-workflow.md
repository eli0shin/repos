---
'repos': minor
---

Add stacked diffs workflow with `repos stack` and `repos restack` commands. The `stack` command creates a new worktree branching from the current branch (instead of main), recording the parent-child relationship in config. The `restack` command rebases the current branch on its parent branch, with automatic fallback to the default branch when the parent has been merged or deleted. Stack relationships are stored as an array of `{ parent, child }` objects inside each repo entry, enabling bidirectional lookups.
