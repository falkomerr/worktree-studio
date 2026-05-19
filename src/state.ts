import { mkdir } from "node:fs/promises";
import { homedir, hostname, platform } from "node:os";
import { join } from "node:path";

export function stateRoot(): string {
    if (process.env.XDG_STATE_HOME) return join(process.env.XDG_STATE_HOME, "worktree-studio");
    if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "Worktree Studio");
    return join(homedir(), ".local", "state", "worktree-studio");
}

export async function ensureLogDir(repoName: string): Promise<string> {
    const dir = join(stateRoot(), "logs", safePathSegment(hostname()), safePathSegment(repoName));
    await mkdir(dir, { recursive: true });
    return dir;
}

export function safePathSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
}
