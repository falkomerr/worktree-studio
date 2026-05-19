# Config

Worktree Studio reads `worktree-studio.json` from the git repository root.

```json
{
    "version": 1,
    "project": {
        "name": "worktree-studio",
        "rootStrategy": "git"
    },
    "commands": [
        {
            "id": "docs.build",
            "label": "Docs build",
            "type": "build",
            "kind": "package-script",
            "packageScript": "docs:build",
            "cwd": ".",
            "mode": "one-shot",
            "visible": true
        }
    ],
    "pipelines": [
        {
            "id": "verify",
            "label": "Verify",
            "steps": [{ "commandId": "docs.build" }],
            "stopOnFailure": true
        }
    ],
    "worktrees": {
        "discover": true,
        "include": ["."],
        "exclude": []
    }
}
```

Important command fields:

| Key | Description |
| --- | --- |
| `id` | Stable command id used by CLI, GUI, and pipelines. |
| `label` | Human-readable label. |
| `type` | `dev`, `build`, `preview`, `test`, `lint`, `pipeline`, or `custom`. |
| `kind` | `package-script` or `shell`. |
| `packageScript` | Package script to run with the detected package manager. |
| `command` | Shell command for trusted project-local commands. |
| `cwd` | Directory inside the selected worktree. |
| `mode` | `one-shot` or `long-running`. |
| `visible` | Hide from quick launch when `false`. |
| `confirm` | Ask before running when `true`. |

Worktree filtering:

| Key | Description |
| --- | --- |
| `worktrees.include` | Visible worktrees. Use `"."` for the repository root, or match by branch, path, basename, `*`, and `?` wildcards. |
| `worktrees.exclude` | Worktrees hidden after includes are applied. Uses the same selector syntax as `include`. |
| `worktrees.discover` | Reserved for discovery behavior; currently worktrees are read from `git worktree list`. |
