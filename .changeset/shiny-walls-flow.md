---
'repos': patch
---

Consolidate release workflow into single job to fix binary publishing. Binaries are now built and uploaded in the same workflow run after changesets creates a release, avoiding GitHub's limitation where GITHUB_TOKEN events don't trigger other workflows.
