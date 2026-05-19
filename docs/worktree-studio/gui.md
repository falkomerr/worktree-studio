# GUI

Launch the Web UI:

```bash
wts gui --port 0
```

The CLI prints a localhost URL with a session token. The GUI and API exist only while that CLI process is running.

Main screen:

- Worktrees: responsive grid of worktrees allowed by `worktrees.include` and `worktrees.exclude`.
- Main worktree: the primary git worktree from `git worktree list` is marked with a `Main worktree` badge and cannot be removed.
- Actions: each worktree card has an action selector and a `Run` button.
- Action status: running and failed actions are shown directly on the worktree card with compact icons.
- Details: click a worktree card to open its runs and logs.
- Settings: configure actions from the same page; actions are saved to `commands[]` in `worktree-studio.json`.
- Pull: fast-forward a branch worktree from its configured upstream with `git pull --ff-only`.
- Remove: delete a non-root worktree from the card menu. Dirty branch worktrees are committed before removal;
  dirty detached worktrees are removed with `git worktree remove --force`.

The API binds to `127.0.0.1` by default and requires the printed token for `/api/*`.
