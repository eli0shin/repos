---
'repos': patch
---

Fix bare repository and worktree detection in the adopt command. Bare repos are now correctly identified and adopted with the `bare: true` flag, and worktrees are no longer incorrectly adopted as separate repositories. Also fixes the shell wrapper to properly cd into new worktrees by sending status messages to stderr.
