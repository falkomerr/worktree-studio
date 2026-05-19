import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("production GUI bundle does not include demo worktrees", async () => {
    const assetsDir = join(process.cwd(), "dist", "web", "assets");
    const files = await readdir(assetsDir);
    const jsFiles = files.filter((file) => file.endsWith(".js"));
    assert.ok(jsFiles.length, "expected built web assets");

    const bundle = (
        await Promise.all(jsFiles.map((file) => readFile(join(assetsDir, file), "utf8")))
    ).join("\n");

    assert.equal(bundle.includes("/workspace/main"), false);
    assert.equal(bundle.includes("/workspace/feature-actions"), false);
    assert.equal(bundle.includes("/workspace/release"), false);
});

test("production GUI bundle exposes worktree pull action", async () => {
    const assetsDir = join(process.cwd(), "dist", "web", "assets");
    const files = await readdir(assetsDir);
    const jsFiles = files.filter((file) => file.endsWith(".js"));
    assert.ok(jsFiles.length, "expected built web assets");

    const bundle = (
        await Promise.all(jsFiles.map((file) => readFile(join(assetsDir, file), "utf8")))
    ).join("\n");

    assert.ok(bundle.includes("Pull worktree"));
});
