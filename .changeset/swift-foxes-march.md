---
'repos': patch
---

Fix `repos work` command failing when the branch already exists locally. Now correctly checks out existing local branches instead of attempting to create a new branch with the same name.
