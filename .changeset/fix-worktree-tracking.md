---
'repos': patch
---

Fix worktree creation to not set upstream tracking to origin/main when creating a new branch that doesn't exist on the remote. New branches now have no tracking until pushed.
