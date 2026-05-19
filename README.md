# Worktree Studio

Project-agnostic CLI and local web UI for running commands across git worktrees.

## Development

```bash
pnpm install
pnpm run build
pnpm run test
pnpm run docs:dev
```

The CLI bins are `wts` and `worktree-studio`.

Agent setup docs live at `docs/agents/self-configure.md`. The short path for a target repository is:

```bash
test -f worktree-studio.json || wts init .
wts config validate
wts gui --port 0
```
