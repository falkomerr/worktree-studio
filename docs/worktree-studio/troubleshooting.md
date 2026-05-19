# Troubleshooting

## Config Does Not Load

```bash
node dist/cli.js config validate
```

The validator reports duplicate command ids, missing executables, and pipelines that reference unknown commands.

## Command Is Missing

```bash
node dist/cli.js commands
```

If a discovered script is useful, import it from the GUI Settings view or add it to `commands[]`.

## Worktree Selector Does Not Match

Selectors can be a branch name, absolute path, directory basename, or `.` for the current checkout.

```bash
node dist/cli.js list
```

## GUI Returns Unauthorized

Use the full URL printed by `node dist/cli.js gui`; it includes `?token=...`.
