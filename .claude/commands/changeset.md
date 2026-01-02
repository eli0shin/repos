---
description: Create a changeset from git history
---

Create a changeset for the current branch automatically:

1. Gather all changes:
   - Run `git log main..HEAD --oneline` to get all commits on this branch
   - Run `git diff` to see unstaged changes
   - Run `git diff --cached` to see staged changes
2. Analyze the commits and current changes to determine the semver bump:
   - `major` if any commit contains "BREAKING" or "!"
   - `minor` if any commit starts with "feat"
   - `patch` otherwise (fix, chore, refactor, docs, etc.)
3. Generate a concise summary (1-2 sentences) describing all changes (commits + uncommitted)
4. Create a changeset file by running `bunx changeset add --empty` then editing the created file, OR by directly writing a new file to `.changeset/` with a random kebab-case name (e.g., `tall-lions.md`)

The changeset file format:

```markdown
---
'repos': <patch|minor|major>
---

<your generated summary>
```

Do not ask me any questions - determine everything from the git history and create the changeset file directly.
