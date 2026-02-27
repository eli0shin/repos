---
'repos': patch
---

Fix unstack and rebase to handle squash/rebase-merged parent branches using fork point tracking, preventing conflicts when rebasing after a parent branch has been squash-merged into main.
