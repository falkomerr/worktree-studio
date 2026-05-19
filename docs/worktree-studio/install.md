# Install

From the standalone project root:

```bash
pnpm install
pnpm run build
pnpm run test
```

The package exposes two equivalent bins when installed or linked:

- `wts`
- `worktree-studio`

During local development, run the built CLI directly:

```bash
node dist/cli.js --help
```

Start this documentation site:

```bash
pnpm docs:dev --host 127.0.0.1
```
