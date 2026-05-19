import assert from "node:assert/strict";
import test from "node:test";

import { parseWorktreePorcelain, selectWorktree } from "../dist/git.js";

test("parses git worktree porcelain output", () => {
    const worktrees = parseWorktreePorcelain(`worktree /repo/main
HEAD abc123
branch refs/heads/main

worktree /repo/feature branch
HEAD def456
detached
prunable stale metadata
`);

    assert.equal(worktrees.length, 2);
    assert.equal(worktrees[0].branch, "main");
    assert.equal(worktrees[1].path, "/repo/feature branch");
    assert.equal(worktrees[1].detached, true);
    assert.equal(worktrees[1].prunable, true);
});

test("selects worktree by branch, path, or basename", () => {
    const worktrees = parseWorktreePorcelain(`worktree /repo/main
HEAD abc123
branch refs/heads/main

worktree /repo/feature
HEAD def456
branch refs/heads/feature/login
`);

    assert.equal(selectWorktree(worktrees, "feature/login")?.path, "/repo/feature");
    assert.equal(selectWorktree(worktrees, "feature")?.branch, "feature/login");
    assert.equal(selectWorktree(worktrees, "/repo/main")?.branch, "main");
});
