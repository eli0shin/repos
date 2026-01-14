---
'repos': minor
---

Add recursive restack and continue command

**Problem**: When stacking branches (a → b → c) and rebasing branch `a` on `main`, the merge-base between `b` and `a` was lost. This caused conflicts when restacking `b` on `a` because git couldn't determine which commits belonged to `b` vs inherited from `a`.

**Solution**: Store fork points in git refs (`refs/bases/<branch>`) and use `git rebase --onto` to rebase only the commits that belong to the child branch.

- `restack` now uses `--onto` with stored fork points to avoid false conflicts after parent is rebased
- `restack` recursively restacks all children branches (use `--only` to limit to current branch)
- New `continue` command to resume a paused rebase and update fork point tracking
- Fork points stored in git refs prevent garbage collection of orphan commits (works even after squashing parent)
