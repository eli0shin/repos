---
'repos': patch
---

Fix editor freeze in `repos continue` by spawning `git rebase --continue` with inherited stdio, allowing the editor to open normally. Also set `stdin: 'ignore'` on piped git commands to prevent hangs if git unexpectedly invokes an editor.
