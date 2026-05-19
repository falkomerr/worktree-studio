# CLI

```bash
wts --help
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
wts init .
wts doctor
wts list
wts commands
wts run . docs.build
wts pipeline . verify
wts gui --port 0
```

For autonomous setup, point agents at [Agent Self Configure](/agents/self-configure).
