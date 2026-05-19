# Bootstrap

Bootstrap information is stored in `worktree-studio.json` under `agentBootstrap.sections[]`.

Print it from the CLI:

```bash
wts agent-bootstrap
```

The same sections are shown in the Web UI Agents tab. They are intended for humans and coding agents that need a quick, project-specific startup checklist.

For first-time repository setup, use the [Agent Self Configure](/agents/self-configure) contract. It tells agents how to discover scripts, create config, validate it, and avoid overwriting human edits.
