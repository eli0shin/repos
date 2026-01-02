---
'repos': patch
---

Fix release workflow to actually publish binaries to GitHub releases. Split binary building into a separate workflow triggered by release events and use bun cross-compilation from a single Linux runner instead of a matrix build.
