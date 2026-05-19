# CLI

```bash
node dist/cli.js --help
```

| Command | Purpose |
| --- | --- |
| `init [repo] [--force]` | Create `worktree-studio.json` from discovered scripts. |
| `list [repo]` | List git worktrees with branch, dirty state, ahead/behind, and path. |
| `commands [repo]` | Show configured commands plus discovered package/Nx commands. |
| `run <worktree> <command-id> [-- args]` | Run a configured command in a selected worktree. |
| `pipeline <worktree> <pipeline-id>` | Run configured pipeline steps sequentially. |
| `gui [repo] [--host 127.0.0.1] [--port 0]` | Start the local Web UI and API server. |
| `config validate [repo]` | Validate config shape and pipeline references. |
| `agent-bootstrap [repo]` | Print copy-ready bootstrap sections from config. |
| `doctor [repo]` | Print repo, config, discovery, and worktree summary. |

Examples:

```bash
node dist/cli.js init .
node dist/cli.js doctor
node dist/cli.js list
node dist/cli.js commands
node dist/cli.js run . docs.build
node dist/cli.js pipeline . verify
node dist/cli.js gui --port 0
```

For autonomous setup, point agents at [Agent Self Configure](/agents/self-configure).
