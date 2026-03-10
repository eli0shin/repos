---
'repos': minor
---

The `work` and `session` commands now automatically record a stack relationship with the default branch when creating new branches, enabling `restack`, `unstack`, `collapse`, and other stack operations on branches created via `work`/`session` (not just via `stack`). Fixes `restack` to correctly handle the parent-is-default-branch case in bare repos.
