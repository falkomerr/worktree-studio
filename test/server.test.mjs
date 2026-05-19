import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { saveProjectConfig } from "../dist/config.js";
import { startGuiServer } from "../dist/server.js";

const execFileAsync = promisify(execFile);

test("rejects API calls without session token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wts-server-"));
    await saveProjectConfig(dir, { version: 1, commands: [], pipelines: [] });
    const server = await startGuiServer(dir, "127.0.0.1", 0);
    try {
        const apiUrl = `${new URL(server.url).origin}/api/config`;
        const unauthorized = await fetch(apiUrl);
        assert.equal(unauthorized.status, 401);

        const authorized = await fetch(`${apiUrl}?token=${server.token}`);
        assert.equal(authorized.status, 200);
        assert.equal((await authorized.json()).config.version, 1);
    } finally {
        await server.close();
    }
});

test("launches configured commands through runs endpoint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wts-server-"));
    await execFileAsync("git", ["init"], { cwd: dir });
    await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { ok: "node -e \"console.log('ok')\"" } }),
    );
    await saveProjectConfig(dir, {
        version: 1,
        commands: [{ id: "ok", label: "OK", packageScript: "ok", mode: "one-shot" }],
        pipelines: [],
    });
    const server = await startGuiServer(dir, "127.0.0.1", 0);
    try {
        const apiUrl = `${new URL(server.url).origin}/api/runs?token=${server.token}`;
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ worktree: ".", commandId: "ok" }),
        });
        const text = await response.text();
        assert.equal(response.status, 201, text);
        assert.equal(JSON.parse(text).run.commandId, "ok");
    } finally {
        await server.close();
    }
});

test("rejects oversized JSON bodies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wts-server-"));
    await saveProjectConfig(dir, { version: 1, commands: [], pipelines: [] });
    const server = await startGuiServer(dir, "127.0.0.1", 0);
    try {
        const apiUrl = `${new URL(server.url).origin}/api/runs?token=${server.token}`;
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ payload: "x".repeat(1024 * 1024) }),
        });
        assert.equal(response.status, 413);
    } finally {
        await server.close();
    }
});
