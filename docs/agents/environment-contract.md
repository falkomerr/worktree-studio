# Environment Contract

Worktree Studio sets these variables for child commands:

| Variable | Description |
| --- | --- |
| `WTS_REPO_ROOT` | Absolute path to the primary repository checkout. |
| `WTS_WORKTREE_PATH` | Absolute path to the selected worktree. |
| `WTS_CONFIG` | Absolute path to `worktree-studio.json`. |
| `WTS_COMMAND_WRAPPER` | Optional command wrapper from config. |

All configured commands run from the selected worktree plus the command `cwd`.

Safety:

- Do not commit or push automatically.
- Do not discard user changes.
- Do not store secrets in config, logs, docs, or memory.
