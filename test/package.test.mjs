import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("exposes global CLI install path", async () => {
    assert.deepEqual(packageJson.bin, {
        wts: "./dist/cli.js",
        "worktree-studio": "./dist/cli.js",
    });
    assert.equal(packageJson.scripts["global:install"], "pnpm run build && pnpm link --global");

    const installDoc = await readFile(new URL("../docs/worktree-studio/install.md", import.meta.url), "utf8");
    assert.match(installDoc, /pnpm add --global worktree-studio/);
    assert.match(installDoc, /pnpm run global:install/);
});
