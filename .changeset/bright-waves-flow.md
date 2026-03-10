---
'repos': patch
---

Fix stale fork point detection in restack, rebase, and unstack operations. When a child branch is manually rebased outside the repos tool, the stored base ref becomes stale, causing rebase --onto to select the wrong commit range. refreshBaseRef now validates the stored ref against git merge-base and resyncs when needed, preventing conflicts especially in squash-merge scenarios where cherry detection cannot match individual commits against squashed ones.
