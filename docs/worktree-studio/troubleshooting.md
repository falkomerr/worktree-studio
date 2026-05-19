# Troubleshooting

## Config Does Not Load

```bash
wts config validate
```

The validator reports duplicate command ids, missing executables, and pipelines that reference unknown commands.

## Command Is Missing

```bash
wts commands
```

If a discovered script is useful, import it from the GUI Settings view or add it to `commands[]`.

## Worktree Selector Does Not Match

Selectors can be a branch name, absolute path, directory basename, or `.` for the current checkout.

```bash
wts list
```

## GUI Returns Unauthorized

Use the full URL printed by `wts gui`; it includes `?token=...`.
