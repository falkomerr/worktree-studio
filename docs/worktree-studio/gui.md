# GUI

Launch the Web UI:

```bash
node dist/cli.js gui --port 0
```

The CLI prints a localhost URL with a session token. The GUI and API exist only while that CLI process is running.

Views:

- Dashboard: worktree rail map, worktree cards, configured and discovered commands.
- Runs & logs: active/recent runs with stdout/stderr/system logs.
- Settings: command editor and advanced JSON editor for `worktree-studio.json`.
- Agents: bootstrap commands from `agentBootstrap.sections[]`.

The API binds to `127.0.0.1` by default and requires the printed token for `/api/*`.
