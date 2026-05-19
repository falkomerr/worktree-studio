import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, stat, writeFile } from "node:fs/promises";
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

test("filters GUI worktrees with project include config", async () => {
    const root = await mkdtemp(join(tmpdir(), "wts-server-"));
    const dir = join(root, "repo");
    const worktreeDir = join(root, "feature");
    await mkdir(dir);
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: dir });
    await writeFile(join(dir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });
    await execFileAsync("git", ["worktree", "add", "-b", "feature/hidden", worktreeDir], { cwd: dir });
    await saveProjectConfig(dir, {
        version: 1,
        commands: [],
        pipelines: [],
        worktrees: { include: ["."], exclude: [] },
    });

    const server = await startGuiServer(dir, "127.0.0.1", 0);
    try {
        const canonicalDir = await realpath(dir);
        const apiUrl = `${new URL(server.url).origin}/api/worktrees?token=${server.token}`;
        const response = await fetch(apiUrl);
        const payload = await response.json();
        assert.deepEqual(
            payload.worktrees.map((worktree) => worktree.path),
            [canonicalDir],
        );
    } finally {
        await server.close();
    }
});

test("removes a worktree through the API", async () => {
    const root = await mkdtemp(join(tmpdir(), "wts-server-"));
    const dir = join(root, "repo");
    const worktreeDir = join(root, "feature");
    await mkdir(dir);
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: dir });
    await writeFile(join(dir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });
    await execFileAsync("git", ["worktree", "add", "-b", "feature/delete-me", worktreeDir], { cwd: dir });
    await saveProjectConfig(dir, {
        version: 1,
        commands: [],
        pipelines: [],
        worktrees: { include: [".", "feature/delete-me"], exclude: [] },
    });

    const server = await startGuiServer(dir, "127.0.0.1", 0);
    try {
        const apiUrl = `${new URL(server.url).origin}/api/worktrees?token=${server.token}`;
        const listed = await fetch(apiUrl);
        const listedPayload = await listed.json();
        assert.equal(
            listedPayload.worktrees.find((worktree) => worktree.branch === "feature/delete-me")?.removable,
            true,
        );
        assert.equal(
            listedPayload.worktrees.find((worktree) => worktree.branch !== "feature/delete-me")?.removable,
            false,
        );

        const response = await fetch(apiUrl, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ worktree: "feature/delete-me" }),
        });
        const text = await response.text();
        assert.equal(response.status, 200, text);
        const payload = JSON.parse(text);
        assert.equal(payload.removed?.branch, "feature/delete-me");
        await assert.rejects(stat(worktreeDir), { code: "ENOENT" });
    } finally {
        await server.close();
    }
});

test("commits dirty worktree changes before removal", async () => {
    const root = await mkdtemp(join(tmpdir(), "wts-server-"));
    const dir = join(root, "repo");
    const worktreeDir = join(root, "dirty-feature");
    await mkdir(dir);
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: dir });
    await writeFile(join(dir, "README.md"), "before\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });
    await execFileAsync("git", ["worktree", "add", "-b", "feature/dirty-delete", worktreeDir], { cwd: dir });
    await writeFile(join(worktreeDir, "README.md"), "after\n");
    await writeFile(join(worktreeDir, "note.txt"), "untracked\n");
    await saveProjectConfig(dir, { version: 1, commands: [], pipelines: [] });

    const server = await startGuiServer(dir, "127.0.0.1", 0);
    try {
        const apiUrl = `${new URL(server.url).origin}/api/worktrees?token=${server.token}`;
        const response = await fetch(apiUrl, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ worktree: "feature/dirty-delete" }),
        });
        const text = await response.text();
        assert.equal(response.status, 200, text);
        const payload = JSON.parse(text);
        assert.match(payload.savedCommit?.message, /Save worktree changes before removal/);
        await assert.rejects(stat(worktreeDir), { code: "ENOENT" });

        const { stdout: message } = await execFileAsync("git", ["log", "-1", "--format=%s", "feature/dirty-delete"], {
            cwd: dir,
            encoding: "utf8",
        });
        const { stdout: readme } = await execFileAsync("git", ["show", "feature/dirty-delete:README.md"], {
            cwd: dir,
            encoding: "utf8",
        });
        const { stdout: note } = await execFileAsync("git", ["show", "feature/dirty-delete:note.txt"], {
            cwd: dir,
            encoding: "utf8",
        });
        assert.match(message, /Save worktree changes before removal/);
        assert.equal(readme, "after\n");
        assert.equal(note, "untracked\n");
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
