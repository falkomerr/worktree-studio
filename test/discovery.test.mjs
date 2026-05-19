import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverCommands } from "../dist/discovery.js";

test("discovers package scripts and Nx targets", async () => {
    const root = await mkdir(join(tmpdir(), `wts-discovery-${Date.now()}`), { recursive: true });
    await writeFile(
        join(root, "package.json"),
        JSON.stringify({ scripts: { "dev:web": "vite dev", "build:web": "vite build" } }),
    );
    await mkdir(join(root, "apps", "web"), { recursive: true });
    await writeFile(
        join(root, "apps", "web", "project.json"),
        `{
            // project.json may contain comments
            "targets": {
                "preview:vite": {
                    "command": "vite preview",
                    "continuous": true
                }
            }
        }`,
    );

    const commands = await discoverCommands(root);
    assert.ok(commands.some((command) => command.id === "root.dev.web" && command.type === "dev"));
    assert.ok(commands.some((command) => command.id === "root.build.web" && command.type === "build"));
    assert.ok(commands.some((command) => command.id === "apps.web.nx.preview.vite" && command.mode === "long-running"));
});
