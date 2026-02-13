---
'repos': patch
---

Add a new `work-clean` shell helper (bash/zsh/fish) that forwards to `repos clean` and changes directory using the returned path. Update `repos clean` to emit machine-readable parent-path output on successful non-dry-run cleanup while keeping status messaging on stderr, and make `rebase --continue` non-interactive so conflict-resolution flows complete reliably in tests.
