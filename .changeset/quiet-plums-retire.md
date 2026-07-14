---
'repos': major
---

Remove the `repos collapse` command and its ambiguous, potentially destructive stack behavior. After merging a parent branch, use `repos cleanup` to remove its worktree while preserving the child's fork point, then run `repos rebase` from the child to rebase it onto the default branch.
