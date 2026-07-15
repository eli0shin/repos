# Repository Workflows

This context describes how repos manages tracked repositories, worktrees, and related branches.

## Language

**Branch Stack**:
A parent/child relationship between branches in which a child is based on its parent and follows that parent when rebased.
_Avoid_: Stack entry, stack relationship

**Fork Point**:
The parent commit from which a child branch diverged, used to preserve the child's own commits when its parent changes.
_Avoid_: Base ref
