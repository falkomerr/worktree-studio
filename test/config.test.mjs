import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConfigError, loadProjectConfig, saveProjectConfig } from "../dist/config.js";

test("loads defaults when config file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wts-config-"));
    const loaded = await loadProjectConfig(dir);

    assert.equal(loaded.exists, false);
    assert.equal(loaded.config.version, 1);
    assert.deepEqual(loaded.config.commands, []);
});

test("round-trips config and preserves unknown keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wts-config-"));
    await saveProjectConfig(dir, {
        version: 1,
        security: { allowArbitraryShell: true },
        futureField: { keep: true },
        commands: [
            {
                id: "test.echo",
                label: "Echo",
                command: "echo ok",
                mode: "one-shot",
            },
        ],
        pipelines: [],
    });

    const loaded = await loadProjectConfig(dir);
    const source = JSON.parse(await readFile(loaded.path, "utf8"));
    assert.equal(source.futureField.keep, true);
    assert.equal(loaded.config.commands[0].id, "test.echo");
});

test("rejects shell commands unless explicitly allowed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wts-config-"));
    await assert.rejects(
        () =>
            saveProjectConfig(dir, {
                version: 1,
                commands: [{ id: "shell", label: "Shell", command: "echo ok" }],
                pipelines: [],
            }),
        /allowArbitraryShell/,
    );
});

test("rejects invalid command definitions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wts-config-"));
    await assert.rejects(
        () =>
            saveProjectConfig(dir, {
                version: 1,
                commands: [{ id: "broken", label: "Broken" }],
                pipelines: [],
            }),
        ConfigError,
    );
});
