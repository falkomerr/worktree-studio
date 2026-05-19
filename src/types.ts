export type CommandMode = "one-shot" | "long-running";
export type CommandType = "dev" | "build" | "preview" | "test" | "lint" | "pipeline" | "custom";
export type CommandKind = "package-script" | "shell";

export interface CommandPortConfig {
    env?: string;
    args?: string[];
    range?: [number, number];
}

export interface WorktreeCommand {
    id: string;
    label: string;
    type?: CommandType;
    kind?: CommandKind;
    command?: string;
    packageScript?: string;
    cwd?: string;
    mode?: CommandMode;
    env?: Record<string, string>;
    port?: number | CommandPortConfig;
    visible?: boolean;
    confirm?: boolean;
}

export interface PipelineStep {
    commandId: string;
    label?: string;
    args?: string[];
}

export interface WorktreePipeline {
    id: string;
    label: string;
    steps: PipelineStep[];
    stopOnFailure?: boolean;
    concurrency?: number;
}

export interface AgentBootstrapSection {
    id: string;
    title: string;
    description?: string;
    commands: string[];
}

export interface WorktreeStudioConfig {
    $schema?: string;
    version: 1;
    project?: {
        name?: string;
        rootStrategy?: "git";
    };
    commandWrapper?: string | string[];
    commands: WorktreeCommand[];
    pipelines: WorktreePipeline[];
    worktrees?: {
        discover?: boolean;
        include?: string[];
        exclude?: string[];
    };
    agentBootstrap?: {
        sections: AgentBootstrapSection[];
    };
    security?: {
        bindHost?: string;
        allowArbitraryShell?: boolean;
        redactEnv?: string[];
    };
    ui?: Record<string, unknown>;
    logs?: {
        retentionDays?: number;
    };
}

export interface LoadedConfig {
    config: WorktreeStudioConfig;
    raw: Record<string, unknown>;
    path: string;
    exists: boolean;
    revision: string;
}

export interface DiscoveredCommand {
    id: string;
    label: string;
    source: "package.json" | "project.json";
    type: CommandType;
    cwd: string;
    command?: string;
    packageScript?: string;
    mode: CommandMode;
}

export interface WorktreeInfo {
    path: string;
    head?: string;
    branch?: string;
    detached?: boolean;
    bare?: boolean;
    prunable?: boolean;
    dirty?: boolean;
    statusLine?: string;
    ahead?: number;
    behind?: number;
    locked?: string;
    reason?: string;
    removable?: boolean;
    isMain?: boolean;
    isCurrent?: boolean;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface RunLogEntry {
    time: string;
    stream: "stdout" | "stderr" | "system";
    text: string;
}

export interface RunInfo {
    id: string;
    commandId: string;
    commandLabel: string;
    worktreePath: string;
    cwd: string;
    status: RunStatus;
    startedAt: string;
    endedAt?: string;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    pid?: number;
    logFile: string;
}
