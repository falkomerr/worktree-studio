# Install

From the standalone project root:

```bash
pnpm install
pnpm run build
pnpm run test
```

## Global CLI

Install the published CLI globally:

```bash
pnpm add --global worktree-studio
wts --help
```

Or link this checkout as the global CLI while developing:

```bash
pnpm install
pnpm run global:install
wts --help
```

The package exposes two equivalent bins:

- `wts`
- `worktree-studio`

After installation, run Worktree Studio through the global utility:

```bash
wts --help
```

Start this documentation site:

```bash
pnpm docs:dev --host 127.0.0.1
```
