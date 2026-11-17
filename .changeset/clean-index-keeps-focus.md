---
'repos': patch
---

`repos clean --index` moves focus to the main worktree only when it closes the Managed Workspace it runs in. Herdr app spaces opened by hand, which the app names after their checkout's folder, are reused instead of opening a duplicate `repo@main` space.
