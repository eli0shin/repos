# repos

A portable git repository manager.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/eli0shin/repos/main/install.sh | bash
```

## Commands

| Command                    | Description                                          |
| -------------------------- | ---------------------------------------------------- |
| `repos list`               | List all tracked repositories                        |
| `repos add <url>`          | Clone a repo and add it to tracking                  |
| `repos clone [name]`       | Clone repos from config (all or specific)            |
| `repos remove <name> [-d]` | Remove a repo from tracking (-d to delete directory) |
| `repos latest`             | Pull all repos in parallel                           |
| `repos adopt`              | Add existing repos to config                         |
| `repos sync`               | Adopt existing + clone missing repos                 |
| `repos update`             | Update repos CLI to latest version                   |
