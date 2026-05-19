import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import type { WorktreeInfo, WorktreeStudioConfig } from "./types.js";

const execFileAsync = promisify(execFile);
const SAVE_BEFORE_REMOVE_MESSAGE = "Save worktree changes before removal";

export interface RemovedWorktreeInfo {
    savedCommit?: {
        hash: string;
        message: string;
    };
}

export interface PulledWorktreeInfo {
    worktree: WorktreeInfo;
    stdout: string;
    stderr: string;
}

interface RemoveWorktreePlan {
    savedCommit?: RemovedWorktreeInfo["savedCommit"];
    forceLevel: 0 | 1 | 2;
}

export async function listWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
    const { stdout } = await execGit(["worktree", "list", "--porcelain"], repoRoot);
    const worktrees = parseWorktreePorcelain(stdout);
    return Promise.all(worktrees.map((worktree) => enrichWorktreeStatus(worktree)));
}

export async function listConfiguredWorktrees(
    repoRoot: string,
    config: WorktreeStudioConfig,
): Promise<WorktreeInfo[]> {
    const worktrees = await listWorktrees(repoRoot);
    return filterWorktrees(worktrees, repoRoot, config);
}

export async function filterWorktrees(
    worktrees: WorktreeInfo[],
    repoRoot: string,
    config: WorktreeStudioConfig,
): Promise<WorktreeInfo[]> {
    const include = config.worktrees?.include?.filter(Boolean);
    const exclude = config.worktrees?.exclude?.filter(Boolean) ?? [];
    const selected = include?.length ? await matchingWorktrees(worktrees, repoRoot, include) : worktrees;

    if (!exclude.length) return selected;

    const excluded = new Set((await matchingWorktrees(worktrees, repoRoot, exclude)).map((worktree) => worktree.path));
    return selected.filter((worktree) => !excluded.has(worktree.path));
}

export async function removeWorktree(repoRoot: string, worktreePath: string): Promise<RemovedWorktreeInfo> {
    const target = (await listWorktrees(repoRoot)).find((worktree) => worktree.path === worktreePath);
    const plan = await planWorktreeRemoval(worktreePath, target);
    const forceArgs = Array.from({ length: plan.forceLevel }, () => "--force");
    await execGit(["worktree", "remove", ...forceArgs, worktreePath], repoRoot);
    return plan.savedCommit ? { savedCommit: plan.savedCommit } : {};
}

export async function pullWorktree(repoRoot: string, worktreePath: string): Promise<PulledWorktreeInfo> {
    const target = (await listWorktrees(repoRoot)).find((worktree) => worktree.path === worktreePath);
    if (!target) throw new Error(`Worktree not found: ${worktreePath}`);
    if (target.prunable) throw new Error(`Cannot pull prunable worktree: ${worktreePath}`);
    if (target.bare) throw new Error(`Cannot pull bare worktree: ${worktreePath}`);
    if (target.detached || !target.branch) throw new Error(`Cannot pull detached worktree: ${worktreePath}`);

    const { stdout, stderr } = await execGit(["pull", "--ff-only"], worktreePath);
    const updated = (await listWorktrees(repoRoot)).find((worktree) => worktree.path === worktreePath);
    return {
        worktree: updated ?? (await enrichWorktreeStatus(target)),
        stdout,
        stderr,
    };
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

async function planWorktreeRemoval(worktreePath: string, worktree?: WorktreeInfo): Promise<RemoveWorktreePlan> {
    const forceLevel = worktree?.locked ? 2 : worktree?.prunable ? 1 : 0;
    if (worktree?.prunable) return { forceLevel };

    const dirtyPlan = await commitDirtyWorktree(worktreePath);
    return {
        savedCommit: dirtyPlan.savedCommit,
        forceLevel: Math.max(forceLevel, dirtyPlan.forceLevel) as 0 | 1 | 2,
    };
}

async function commitDirtyWorktree(
    worktreePath: string,
): Promise<{ savedCommit?: RemovedWorktreeInfo["savedCommit"]; forceLevel: 0 | 1 }> {
    const { stdout: status } = await execGit(["status", "--porcelain"], worktreePath);
    if (!status.trim()) return { forceLevel: 0 };

    const { stdout: branch } = await execGit(["branch", "--show-current"], worktreePath);
    if (!branch.trim()) {
        return { forceLevel: 1 };
    }

    await execGit(["add", "-A"], worktreePath);
    try {
        await execGit(["diff", "--cached", "--quiet"], worktreePath);
        return { forceLevel: 0 };
    } catch (error) {
        if ((error as { code?: number }).code !== 1) throw error;
    }

    await execGit(["commit", "--no-verify", "-m", SAVE_BEFORE_REMOVE_MESSAGE], worktreePath);
    const { stdout: hash } = await execGit(["rev-parse", "HEAD"], worktreePath);
    return {
        savedCommit: {
            hash: hash.trim(),
            message: SAVE_BEFORE_REMOVE_MESSAGE,
        },
        forceLevel: 0,
    };
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

async function matchingWorktrees(
    worktrees: WorktreeInfo[],
    repoRoot: string,
    selectors: string[],
): Promise<WorktreeInfo[]> {
    const matches: WorktreeInfo[] = [];
    for (const worktree of worktrees) {
        for (const selector of selectors) {
            if (await matchesWorktree(worktree, repoRoot, selector)) {
                matches.push(worktree);
                break;
            }
        }
    }
    return matches;
}

async function matchesWorktree(worktree: WorktreeInfo, repoRoot: string, selector: string): Promise<boolean> {
    const canonicalWorktree = await canonicalPath(worktree.path);
    if (selector === "." || selector === "./") return true;

    const selectorPath = resolve(repoRoot, selector);
    const values = [
        worktree.branch,
        worktree.path,
        canonicalWorktree,
        basename(worktree.path),
        resolve(worktree.path),
        selectorPath === selector ? undefined : selectorPath,
    ].filter((value): value is string => Boolean(value));

    if (values.includes(selector)) return true;

    if (!isWildcard(selector)) {
        return canonicalWorktree === (await canonicalPath(selectorPath));
    }

    const wildcard = wildcardRegExp(selector);
    return values.some((value) => wildcard.test(value));
}

async function canonicalPath(path: string): Promise<string> {
    try {
        return await realpath(path);
    } catch {
        return resolve(path);
    }
}

function isWildcard(value: string): boolean {
    return /[*?]/.test(value);
}

function wildcardRegExp(value: string): RegExp {
    return new RegExp(
        `^${value
            .replace(/[|\\{}()[\]^$+*?.]/g, "\\$&")
            .replace(/\\\*/g, ".*")
            .replace(/\\\?/g, ".")}$`,
    );
}
