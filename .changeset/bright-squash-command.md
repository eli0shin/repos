---
'repos': minor
---

Add `repos squash` command to squash all commits since the base branch into a single commit. Supports `-m` flag for inline message, `-f/--first` flag to use the first commit's message, or opens an editor by default. Works with both regular branches (squashes since default branch) and stacked branches (squashes since parent branch).
