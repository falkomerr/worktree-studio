# Agent Quickstart

For first-time setup in a repository, start with [Agent Self Configure](/agents/self-configure). This page is the shorter daily checklist once `worktree-studio.json` exists.

```bash
git status --short --branch
pnpm install
pnpm run build
pnpm run test
pnpm run docs:build
wts doctor
wts list
wts commands
```

Read project bootstrap hints:

```bash
wts agent-bootstrap
```

Agents should use configured command ids instead of arbitrary shell commands where possible.
