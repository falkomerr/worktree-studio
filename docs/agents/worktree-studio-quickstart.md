# Agent Quickstart

For first-time setup in a repository, start with [Agent Self Configure](/agents/self-configure). This page is the shorter daily checklist once `worktree-studio.json` exists.

```bash
git status --short --branch
pnpm install
pnpm run build
pnpm run test
pnpm run docs:build
node dist/cli.js doctor
node dist/cli.js list
node dist/cli.js commands
```

Read project bootstrap hints:

```bash
node dist/cli.js agent-bootstrap
```

Agents should use configured command ids instead of arbitrary shell commands where possible.
