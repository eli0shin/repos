---
'repos': major
---

Remove the `repos collapse` command and its ambiguous, potentially destructive stack behavior. After merging and cleaning up a parent worktree, run `repos rebase` from the child to rebase it onto the default branch.
