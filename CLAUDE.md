# repos CLI

A Bun-based CLI tool for managing git repositories in `~/code`.

## Development

```bash
bun install      # Install dependencies
bun test         # Run tests
bun run build    # Build executable
bun run dev      # Run in development mode
bun run lint     # Run ESLint
bun run format   # Check formatting
```

## Architecture

- `src/cli.ts` - Entry point, argument parsing
- `src/config.ts` - repos.json read/write operations
- `src/git.ts` - Git command wrappers (clone, pull, branch detection)
- `src/output.ts` - stdout/stderr output utilities
- `src/commands/` - Individual command implementations

## Commands

- `repos add <url>` - Clone and track a repo
- `repos clone [name]` - Clone repos from config
- `repos list` - List tracked repos with status
- `repos remove <name> [--delete]` - Untrack repo
- `repos latest` - Parallel pull all repos
- `repos adopt` - Add existing repos to config
- `repos sync` - Adopt + clone missing

## Config Location

`~/code/repos.json` - JSON file with repo entries (name, url, branch)

## Testing

Tests use real git operations on temp directories. No mocking of deterministic functions.

```bash
bun test              # Run all tests
bun test:watch        # Watch mode
```

## Publishing

Uses changesets for versioning:

```bash
bunx changeset        # Create a changeset
bunx changeset version # Update version
npm publish           # Publish to npm
```
