import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseJsonObject } from "./json.js";
import type { LoadedConfig, WorktreeCommand, WorktreePipeline, WorktreeStudioConfig } from "./types.js";

export const CONFIG_FILE_NAME = "worktree-studio.json";

export class ConfigError extends Error {
    public readonly issues: string[];

    public constructor(issues: string[]) {
        super(issues.join("\n"));
        this.name = "ConfigError";
        this.issues = issues;
    }
}

export function configPath(repoRoot: string): string {
    return join(repoRoot, CONFIG_FILE_NAME);
}

export function defaultConfig(repoRoot: string): WorktreeStudioConfig {
    return {
        $schema: "https://worktree-studio.local/schema/v1.json",
        version: 1,
        project: {
            name: basename(repoRoot),
            rootStrategy: "git",
        },
        commands: [],
        pipelines: [],
        worktrees: {
            discover: true,
            include: ["."],
            exclude: [],
        },
        agentBootstrap: {
            sections: [
                {
                    id: "self-configure",
                    title: "Agent self-configure",
                    description: "Initialize and validate Worktree Studio for this repository.",
                    commands: [
                        "wts doctor",
                        "test -f worktree-studio.json || wts init .",
                        "wts config validate",
                        "wts commands",
                        "wts list",
                    ],
                },
                {
                    id: "daily-bootstrap",
                    title: "Daily bootstrap",
                    description: "Fast orientation commands for humans and agents after config exists.",
                    commands: ["wts list", "wts commands", "wts agent-bootstrap"],
                },
            ],
        },
        security: {
            bindHost: "127.0.0.1",
            allowArbitraryShell: false,
            redactEnv: ["*_TOKEN", "*PASSWORD*", "*SECRET*", "*COOKIE*"],
        },
    };
}

export async function loadProjectConfig(repoRoot: string): Promise<LoadedConfig> {
    const path = configPath(repoRoot);
    const defaults = defaultConfig(repoRoot);
    try {
        const [source, revision] = await Promise.all([readFile(path, "utf8"), getConfigRevision(path)]);
        const raw = parseJsonObject(source, path);
        const config = normalizeConfig(raw, defaults);
        return { config, raw, path, exists: true, revision };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return { config: defaults, raw: { ...defaults }, path, exists: false, revision: "missing" };
        }
        throw error;
    }
}

export async function saveProjectConfig(
    repoRoot: string,
    raw: Record<string, unknown>,
    expectedRevision?: string,
): Promise<LoadedConfig> {
    const path = configPath(repoRoot);
    if (expectedRevision) {
        const currentRevision = await getConfigRevision(path);
        if (currentRevision !== expectedRevision) {
            throw new ConfigError([`Config changed on disk: expected ${expectedRevision}, got ${currentRevision}`]);
        }
    }
    const defaults = defaultConfig(repoRoot);
    normalizeConfig(raw, defaults);
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(raw, null, 4)}\n`, "utf8");
    await rename(tempPath, path);
    return loadProjectConfig(repoRoot);
}

export async function getConfigRevision(path: string): Promise<string> {
    try {
        const stats = await stat(path);
        return `${stats.mtimeMs}:${stats.size}`;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
        throw error;
    }
}

export function normalizeConfig(raw: Record<string, unknown>, defaults: WorktreeStudioConfig): WorktreeStudioConfig {
    const issues: string[] = [];
    const version = raw.version ?? defaults.version;
    if (version !== 1) issues.push("version must be 1");

    const commands = readArray<WorktreeCommand>(raw.commands, "commands", issues);
    const pipelines = readArray<WorktreePipeline>(raw.pipelines, "pipelines", issues);
    const project = readObject(raw.project, "project", issues) ?? defaults.project;
    const worktrees = readObject(raw.worktrees, "worktrees", issues) ?? defaults.worktrees;
    const security = readObject(raw.security, "security", issues) ?? defaults.security;
    const agentBootstrap = readObject(raw.agentBootstrap, "agentBootstrap", issues) ?? defaults.agentBootstrap;
    const allowArbitraryShell = security?.allowArbitraryShell === true;

    validateCommands(commands, issues, allowArbitraryShell);
    validatePipelines(pipelines, commands, issues);

    if (security?.bindHost !== undefined && typeof security.bindHost !== "string") {
        issues.push("security.bindHost must be a string");
    }
    if (security?.allowArbitraryShell !== undefined && typeof security.allowArbitraryShell !== "boolean") {
        issues.push("security.allowArbitraryShell must be a boolean");
    }

    const wrapper = raw.commandWrapper;
    if (
        wrapper !== undefined &&
        typeof wrapper !== "string" &&
        (!Array.isArray(wrapper) || wrapper.some((item) => typeof item !== "string"))
    ) {
        issues.push("commandWrapper must be a string or string array");
    }

    if (issues.length) throw new ConfigError(issues);

    return {
        ...(raw as unknown as WorktreeStudioConfig),
        version: 1,
        project: project as WorktreeStudioConfig["project"],
        commandWrapper: wrapper as WorktreeStudioConfig["commandWrapper"],
        commands,
        pipelines,
        worktrees: worktrees as WorktreeStudioConfig["worktrees"],
        agentBootstrap: agentBootstrap as WorktreeStudioConfig["agentBootstrap"],
        security: security as WorktreeStudioConfig["security"],
    };
}

function readArray<T>(value: unknown, name: string, issues: string[]): T[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        issues.push(`${name} must be an array`);
        return [];
    }
    return value as T[];
}

function readObject(value: unknown, name: string, issues: string[]): Record<string, unknown> | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        issues.push(`${name} must be an object`);
        return undefined;
    }
    return value as Record<string, unknown>;
}

function validateCommands(commands: WorktreeCommand[], issues: string[], allowArbitraryShell: boolean): void {
    const ids = new Set<string>();
    commands.forEach((command, index) => {
        const prefix = `commands[${index}]`;
        if (!command || typeof command !== "object") {
            issues.push(`${prefix} must be an object`);
            return;
        }
        if (!command.id || typeof command.id !== "string") issues.push(`${prefix}.id must be a string`);
        if (command.id && ids.has(command.id)) issues.push(`${prefix}.id duplicates ${command.id}`);
        if (command.id) ids.add(command.id);
        if (!command.label || typeof command.label !== "string") issues.push(`${prefix}.label must be a string`);
        if (!command.command && !command.packageScript) issues.push(`${prefix} needs command or packageScript`);
        if (command.command && typeof command.command !== "string") issues.push(`${prefix}.command must be a string`);
        if (command.command && !allowArbitraryShell) {
            issues.push(`${prefix}.command requires security.allowArbitraryShell to be true`);
        }
        if (command.packageScript && typeof command.packageScript !== "string") {
            issues.push(`${prefix}.packageScript must be a string`);
        }
        if (command.mode !== undefined && command.mode !== "one-shot" && command.mode !== "long-running") {
            issues.push(`${prefix}.mode must be one-shot or long-running`);
        }
        if (command.cwd !== undefined && typeof command.cwd !== "string") issues.push(`${prefix}.cwd must be a string`);
    });
}

function validatePipelines(pipelines: WorktreePipeline[], commands: WorktreeCommand[], issues: string[]): void {
    const commandIds = new Set(commands.map((command) => command.id));
    const pipelineIds = new Set<string>();
    pipelines.forEach((pipeline, index) => {
        const prefix = `pipelines[${index}]`;
        if (!pipeline || typeof pipeline !== "object") {
            issues.push(`${prefix} must be an object`);
            return;
        }
        if (!pipeline.id || typeof pipeline.id !== "string") issues.push(`${prefix}.id must be a string`);
        if (pipeline.id && pipelineIds.has(pipeline.id)) issues.push(`${prefix}.id duplicates ${pipeline.id}`);
        if (pipeline.id) pipelineIds.add(pipeline.id);
        if (!pipeline.label || typeof pipeline.label !== "string") issues.push(`${prefix}.label must be a string`);
        if (!Array.isArray(pipeline.steps) || pipeline.steps.length === 0) {
            issues.push(`${prefix}.steps must be a non-empty array`);
            return;
        }
        pipeline.steps.forEach((step, stepIndex) => {
            if (!step.commandId || typeof step.commandId !== "string") {
                issues.push(`${prefix}.steps[${stepIndex}].commandId must be a string`);
            } else if (!commandIds.has(step.commandId)) {
                issues.push(`${prefix}.steps[${stepIndex}].commandId references unknown command ${step.commandId}`);
            }
        });
    });
}
