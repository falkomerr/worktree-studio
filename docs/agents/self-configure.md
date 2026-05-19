# Agent Self Configure

This page is the project setup contract for autonomous coding agents. The goal is to create a useful `worktree-studio.json` without relying on a human to open the GUI first.

## Bootstrap Path

Run these from the target git repository:

```bash
git status --short --branch
wts doctor
test -f worktree-studio.json || wts init .
wts config validate
wts commands
wts list
```

If `worktree-studio.json` already exists, do not overwrite it by default. Read it, preserve project-specific edits, and use `wts init . --force` only when the user explicitly asks for regeneration.

## What Agents Should Configure

1. Import discovered package scripts and Nx targets with `wts init .`, then keep only the actions needed for normal agent work.
2. Configure the minimal useful action set: dev servers, production builds, build preview commands, relevant test variants, and pipelines.
3. Hide noisy helper scripts and unrelated package scripts by setting `"visible": false`.
4. Add pipelines for common verification paths, for example `verify`, `verify:web`, or `verify:docs`.
5. Add `agentBootstrap.sections[]` with copy-ready commands for future agents.
6. Run `wts config validate` after every config edit.

## Safe Editing Rules

- Do not delete or rewrite existing commands unless the user asked for cleanup.
- Do not add secrets to `env`, `agentBootstrap`, docs, or logs.
- Prefer configured command ids over arbitrary shell commands once config exists.
- Keep destructive git or infrastructure operations out of Worktree Studio commands.
- Use `security.redactEnv` for token-like environment names.

## Minimal Agent Section

```json
{
  "agentBootstrap": {
    "sections": [
      {
        "id": "self-configure",
        "title": "Agent self-configure",
        "description": "Initialize and validate Worktree Studio for this repository.",
        "commands": [
          "wts doctor",
          "test -f worktree-studio.json || wts init .",
          "wts config validate",
          "wts commands",
          "wts list"
        ]
      }
    ]
  }
}
```

## Review Checklist

Before handing back the project:

```bash
wts config validate
wts commands
wts agent-bootstrap
```

If the repository has docs, also run the configured docs build command or the project-native equivalent.
