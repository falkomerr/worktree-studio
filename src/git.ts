import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import type { WorktreeInfo } from "./types.js";

const execFileAsync = promisify(execFile);

export async function listWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
    const { stdout } = await execGit(["worktree", "list", "--porcelain"], repoRoot);
    const worktrees = parseWorktreePorcelain(stdout);
    return Promise.all(worktrees.map((worktree) => enrichWorktreeStatus(worktree)));
}

export function parseWorktreePorcelain(output: string): WorktreeInfo[] {
    const records = output
        .split(/\n{2,}/)
        .map((record) => record.trim())
        .filter(Boolean);
    return records.map((record) => {
        const worktree: WorktreeInfo = { path: "" };
        for (const line of record.split("\n")) {
            const [key, ...rest] = line.split(" ");
            const value = rest.join(" ");
            switch (key) {
                case "worktree":
                    worktree.path = value;
                    break;
                case "HEAD":
                    worktree.head = value;
                    break;
                case "branch":
                    worktree.branch = value.replace(/^refs\/heads\//, "");
                    break;
                case "detached":
                    worktree.detached = true;
                    break;
                case "bare":
                    worktree.bare = true;
                    break;
                case "prunable":
                    worktree.prunable = true;
                    worktree.reason = value || worktree.reason;
                    break;
                case "locked":
                    worktree.locked = value || "locked";
                    break;
            }
        }
        return worktree;
    });
}

export async function enrichWorktreeStatus(worktree: WorktreeInfo): Promise<WorktreeInfo> {
    if (!worktree.path || worktree.prunable) return worktree;
    try {
        const { stdout } = await execGit(["status", "--short", "--branch"], worktree.path);
        const lines = stdout.trimEnd().split("\n").filter(Boolean);
        const statusLine = lines[0] ?? "";
        const ahead = /\[ahead (\d+)/.exec(statusLine)?.[1];
        const behind = /\bbehind (\d+)/.exec(statusLine)?.[1];
        return {
            ...worktree,
            statusLine,
            dirty: lines.length > 1,
            ahead: ahead ? Number(ahead) : 0,
            behind: behind ? Number(behind) : 0,
        };
    } catch (error) {
        return {
            ...worktree,
            dirty: undefined,
            reason: error instanceof Error ? error.message : "Could not read status",
        };
    }
}

async function execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    const attempts: Array<[string, string[]]> = [
        ["git", args],
        [`${homedir()}/.local/bin/git`, args],
        ["/opt/homebrew/bin/git", args],
        ["/usr/local/bin/git", args],
        ["/usr/bin/git", args],
        ["rtk", ["git", ...args]],
        [`${homedir()}/.local/bin/rtk`, ["git", ...args]],
    ];
    let lastError: unknown;
    for (const [file, commandArgs] of attempts) {
        try {
            return await execFileAsync(file, commandArgs, { cwd, encoding: "utf8" });
        } catch (error) {
            lastError = error;
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
    throw lastError;
}

export function selectWorktree(worktrees: WorktreeInfo[], selector: string): WorktreeInfo | undefined {
    const resolved = resolve(selector);
    return worktrees.find((worktree) => {
        return (
            worktree.path === selector ||
            resolve(worktree.path) === resolved ||
            worktree.branch === selector ||
            basename(worktree.path) === selector
        );
    });
}
