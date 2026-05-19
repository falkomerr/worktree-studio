import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProcessRunner } from "../dist/runner.js";

test("runs one-shot shell command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wts-runner-"));
    const runner = new ProcessRunner(dir, {
        version: 1,
        security: { allowArbitraryShell: true },
        commands: [{ id: "ok", label: "OK", command: "node -e \"console.log('ok')\"", mode: "one-shot" }],
        pipelines: [],
    });

    const run = await runner.startRun({ worktreePath: dir, commandId: "ok" });
    const finished = await runner.waitForRun(run.id);

    assert.equal(finished.status, "succeeded");
    assert.match(
        runner
            .getLogs(run.id)
            .map((entry) => entry.text)
            .join(""),
        /ok/,
    );
});

test("pipeline stops on first failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wts-runner-"));
    const runner = new ProcessRunner(dir, {
        version: 1,
        security: { allowArbitraryShell: true },
        commands: [
            { id: "fail", label: "Fail", command: 'node -e "process.exit(7)"', mode: "one-shot" },
            { id: "skip", label: "Skip", command: "node -e \"console.log('skip')\"", mode: "one-shot" },
        ],
        pipelines: [{ id: "verify", label: "Verify", steps: [{ commandId: "fail" }, { commandId: "skip" }] }],
    });

    const runs = await runner.runPipeline(dir, "verify");

    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "failed");
    assert.equal(runs[0].exitCode, 7);
});

test("rejects shell command execution when arbitrary shell is disabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wts-runner-"));
    const runner = new ProcessRunner(dir, {
        version: 1,
        commands: [{ id: "shell", label: "Shell", command: "echo unsafe", mode: "one-shot" }],
        pipelines: [],
    });

    await assert.rejects(
        () => runner.startRun({ worktreePath: dir, commandId: "shell" }),
        /allowArbitraryShell/,
    );
});
