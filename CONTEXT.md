# Repository Workflows

This context describes how repos manages tracked repositories, worktrees, and related branches.

## Language

**Branch Stack**:
A parent/child relationship between branches in which a child is based on its parent and follows that parent when rebased.
_Avoid_: Stack entry, stack relationship

**Fork Point**:
The parent commit from which a child branch diverged, used to preserve the child's own commits when its parent changes.
_Avoid_: Base ref

**Workspace Manager**:
A terminal environment that owns persistent work contexts for repository worktrees.
_Avoid_: Multiplexer, tmux integration

**Managed Workspace**:
A persistent terminal work context associated with one repository worktree.
_Avoid_: Session
