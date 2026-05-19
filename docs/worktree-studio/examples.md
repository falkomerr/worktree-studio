# Examples

Build and inspect the project:

```bash
pnpm run build
node dist/cli.js doctor
node dist/cli.js list
node dist/cli.js commands
```

Run documentation commands through Worktree Studio:

```bash
node dist/cli.js run . docs.build
node dist/cli.js pipeline . verify
```

Launch the GUI:

```bash
node dist/cli.js gui --port 0
```
