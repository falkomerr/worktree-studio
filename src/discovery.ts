import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { parseJsonObject } from "./json.js";
import type { CommandMode, CommandType, DiscoveredCommand, WorktreeCommand, WorktreeStudioConfig } from "./types.js";

const IGNORED_DIRECTORIES = new Set([
    ".git",
    ".nx",
    ".turbo",
    ".yarn",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "webapp",
    "storybook-static",
]);

export function findRepoRoot(cwd = process.cwd()): string {
    try {
        return execFileSync("git", ["rev-parse", "--show-toplevel"], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        return cwd;
    }
}

export function detectPackageManager(repoRoot: string): string {
    const candidates: Array<[string, string]> = [
        ["pnpm-lock.yaml", "pnpm"],
        ["bun.lock", "bun"],
        ["bun.lockb", "bun"],
        ["yarn.lock", "yarn"],
        ["package-lock.json", "npm"],
    ];
    for (const [fileName, manager] of candidates) {
        try {
            execFileSync("test", ["-f", join(repoRoot, fileName)]);
            return manager;
        } catch {
            continue;
        }
    }
    return "npm";
}

export async function discoverCommands(repoRoot: string): Promise<DiscoveredCommand[]> {
    const [packageCommands, nxCommands] = await Promise.all([
        discoverPackageScripts(repoRoot),
        discoverNxTargets(repoRoot),
    ]);
    const byId = new Map<string, DiscoveredCommand>();
    for (const command of [...packageCommands, ...nxCommands]) {
        if (!byId.has(command.id)) byId.set(command.id, command);
    }
    return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function configuredAndDiscoveredCommands(
    config: WorktreeStudioConfig,
    discovered: DiscoveredCommand[],
): Array<WorktreeCommand & { discovered?: boolean }> {
    const configured = config.commands.map((command) => ({ ...command, discovered: false }));
    const configuredIds = new Set(config.commands.map((command) => command.id));
    const imported = discovered
        .filter((command) => !configuredIds.has(command.id))
        .map((command) => ({ ...discoveredToConfig(command), discovered: true }));
    return [...configured, ...imported];
}

export function discoveredToConfig(command: DiscoveredCommand): WorktreeCommand {
    return {
        id: command.id,
        label: command.label,
        type: command.type,
        kind: command.packageScript ? "package-script" : "shell",
        command: command.command,
        packageScript: command.packageScript,
        cwd: command.cwd,
        mode: command.mode,
        visible: true,
    };
}

async function discoverPackageScripts(repoRoot: string): Promise<DiscoveredCommand[]> {
    const packageJsonPaths = await findFiles(repoRoot, "package.json", 4);
    const commands: DiscoveredCommand[] = [];
    for (const path of packageJsonPaths) {
        const packageDir = path.slice(0, -"package.json".length - 1);
        const cwd = normalizeRelative(repoRoot, packageDir);
        const packageJson = await readJson(path);
        const scripts = packageJson.scripts;
        if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) continue;
        for (const [script, value] of Object.entries(scripts)) {
            if (typeof value !== "string") continue;
            const type = classifyCommand(script, value);
            const mode = classifyMode(script, value);
            commands.push({
                id: `${scopeId(cwd)}.${script.replaceAll(":", ".")}`,
                label: `${labelScope(cwd)} ${script}`,
                source: "package.json",
                type,
                cwd,
                packageScript: script,
                mode,
            });
        }
    }
    return commands;
}

async function discoverNxTargets(repoRoot: string): Promise<DiscoveredCommand[]> {
    const projectJsonPaths = await findFiles(repoRoot, "project.json", 5);
    const commands: DiscoveredCommand[] = [];
    for (const path of projectJsonPaths) {
        const projectDir = path.slice(0, -"project.json".length - 1);
        const cwd = normalizeRelative(repoRoot, projectDir);
        const projectJson = await readJson(path);
        const targets = projectJson.targets;
        if (!targets || typeof targets !== "object" || Array.isArray(targets)) continue;
        for (const [targetName, targetValue] of Object.entries(targets)) {
            if (!targetValue || typeof targetValue !== "object" || Array.isArray(targetValue)) continue;
            const target = targetValue as Record<string, unknown>;
            const command = typeof target.command === "string" ? target.command : undefined;
            const type = classifyCommand(targetName, command ?? "");
            const mode = target.continuous === true ? "long-running" : classifyMode(targetName, command ?? "");
            commands.push({
                id: `${scopeId(cwd)}.nx.${targetName.replaceAll(":", ".")}`,
                label: `${labelScope(cwd)} nx ${targetName}`,
                source: "project.json",
                type,
                cwd,
                command: command ?? `nx ${targetName}`,
                mode,
            });
        }
    }
    return commands;
}

async function findFiles(root: string, fileName: string, maxDepth: number): Promise<string[]> {
    const results: string[] = [];
    async function walk(directory: string, depth: number): Promise<void> {
        if (depth > maxDepth) return;
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (!IGNORED_DIRECTORIES.has(entry.name)) {
                    await walk(join(directory, entry.name), depth + 1);
                }
            } else if (entry.isFile() && entry.name === fileName) {
                results.push(join(directory, entry.name));
            }
        }
    }
    await walk(root, 0);
    return results;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
    return parseJsonObject(await readFile(path, "utf8"), path);
}

function classifyCommand(name: string, command: string): CommandType {
    const haystack = `${name} ${command}`.toLowerCase();
    if (haystack.includes("preview")) return "preview";
    if (haystack.includes("lint") || haystack.includes("eslint") || haystack.includes("stylelint")) return "lint";
    if (
        haystack.includes("test") ||
        haystack.includes("vitest") ||
        haystack.includes("jest") ||
        haystack.includes("playwright")
    ) {
        return "test";
    }
    if (haystack.includes("build") || haystack.includes("dist") || haystack.includes("pack")) return "build";
    if (haystack.includes("dev") || haystack.includes("start") || haystack.includes("storybook")) return "dev";
    return "custom";
}

function classifyMode(name: string, command: string): CommandMode {
    const haystack = `${name} ${command}`.toLowerCase();
    if (haystack.includes("build") || haystack.includes("dist") || haystack.includes("pack")) return "one-shot";
    if (
        haystack.includes(" dev") ||
        haystack.includes(":dev") ||
        haystack.includes("start") ||
        haystack.includes("preview") ||
        haystack.includes("--watch") ||
        haystack.includes("storybook")
    ) {
        return "long-running";
    }
    return "one-shot";
}

function normalizeRelative(root: string, path: string): string {
    const result = relative(root, path);
    return result === "" ? "." : result;
}

function scopeId(cwd: string): string {
    return cwd === "." ? "root" : cwd.replace(/[^a-zA-Z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
}

function labelScope(cwd: string): string {
    return cwd === "." ? "Root" : basename(cwd);
}
