import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { basename, join, resolve } from "node:path";
import { detectPackageManager } from "./discovery.js";
import { findFreePort } from "./ports.js";
import { ensureLogDir, safePathSegment } from "./state.js";
import type { RunInfo, RunLogEntry, WorktreeCommand, WorktreePipeline, WorktreeStudioConfig } from "./types.js";

interface RunRecord {
    info: RunInfo;
    child?: ChildProcessWithoutNullStreams;
    logs: RunLogEntry[];
    logStream: WriteStream;
    done: Promise<RunInfo>;
    resolveDone: (info: RunInfo) => void;
}

export interface StartRunOptions {
    worktreePath: string;
    commandId: string;
    extraArgs?: string[];
}

export class ProcessRunner extends EventEmitter {
    private readonly runs = new Map<string, RunRecord>();
    private readonly packageManager: string;

    public constructor(
        private readonly repoRoot: string,
        private readonly config: WorktreeStudioConfig,
    ) {
        super();
        this.packageManager = detectPackageManager(repoRoot);
    }

    public listRuns(): RunInfo[] {
        return [...this.runs.values()].map((record) => ({ ...record.info }));
    }

    public getRun(id: string): RunInfo | undefined {
        const record = this.runs.get(id);
        return record ? { ...record.info } : undefined;
    }

    public getLogs(id: string): RunLogEntry[] {
        return this.runs.get(id)?.logs.map((entry) => ({ ...entry })) ?? [];
    }

    public async startRun(options: StartRunOptions): Promise<RunInfo> {
        const command = this.config.commands.find((item) => item.id === options.commandId);
        if (!command) throw new Error(`Unknown command: ${options.commandId}`);
        const resolved = await this.resolveCommand(command, options.worktreePath, options.extraArgs ?? []);
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const logDir = await ensureLogDir(this.config.project?.name ?? basename(this.repoRoot));
        await mkdir(logDir, { recursive: true });
        const logFile = join(logDir, `${safePathSegment(command.id)}-${id}.log`);
        const logStream = createWriteStream(logFile, { flags: "a" });
        let resolveDone!: (info: RunInfo) => void;
        const done = new Promise<RunInfo>((resolveDonePromise) => {
            resolveDone = resolveDonePromise;
        });
        const info: RunInfo = {
            id,
            commandId: command.id,
            commandLabel: command.label,
            worktreePath: options.worktreePath,
            cwd: resolved.cwd,
            status: "queued",
            startedAt: new Date().toISOString(),
            logFile,
        };
        const record: RunRecord = { info, logs: [], logStream, done, resolveDone };
        this.runs.set(id, record);
        this.appendLog(record, "system", `$ ${resolved.displayCommand}\n`);

        const child = spawn(resolved.file, resolved.args, {
            cwd: resolved.cwd,
            env: resolved.env,
            shell: false,
            detached: process.platform !== "win32",
        });
        record.child = child;
        record.info.status = "running";
        record.info.pid = child.pid;
        this.emitRun(record);

        child.stdout.on("data", (chunk: Buffer) => this.appendLog(record, "stdout", chunk.toString("utf8")));
        child.stderr.on("data", (chunk: Buffer) => this.appendLog(record, "stderr", chunk.toString("utf8")));
        child.on("error", (error) => {
            this.appendLog(record, "system", `${error.message}\n`);
        });
        child.on("close", (exitCode, signal) => {
            record.info.endedAt = new Date().toISOString();
            record.info.exitCode = exitCode;
            record.info.signal = signal;
            record.info.status =
                record.info.status === "cancelled" ? "cancelled" : exitCode === 0 ? "succeeded" : "failed";
            this.appendLog(record, "system", `Process exited with ${exitCode ?? signal ?? "unknown"}\n`);
            record.logStream.end();
            this.emitRun(record);
            record.resolveDone({ ...record.info });
        });

        return { ...record.info };
    }

    public async waitForRun(id: string): Promise<RunInfo> {
        const record = this.runs.get(id);
        if (!record) throw new Error(`Unknown run: ${id}`);
        return record.done;
    }

    public stopRun(id: string): boolean {
        const record = this.runs.get(id);
        if (!record?.child || record.info.status !== "running") return false;
        record.info.status = "cancelled";
        this.emitRun(record);
        const pid = record.child.pid;
        if (!pid) return false;
        try {
            if (process.platform === "win32") {
                record.child.kill("SIGINT");
            } else {
                process.kill(-pid, "SIGINT");
            }
            setTimeout(() => {
                if (record.info.status === "running" || record.info.status === "cancelled") {
                    try {
                        if (process.platform === "win32") record.child?.kill("SIGTERM");
                        else process.kill(-pid, "SIGTERM");
                    } catch {
                        // process already exited
                    }
                }
            }, 5000).unref();
            return true;
        } catch {
            record.child.kill("SIGTERM");
            return true;
        }
    }

    public async stopAll(): Promise<void> {
        for (const run of this.listRuns()) {
            this.stopRun(run.id);
        }
        await Promise.allSettled(
            this.listRuns()
                .filter((run) => run.status === "running" || run.status === "cancelled")
                .map((run) => this.waitForRun(run.id)),
        );
    }

    public async runPipeline(worktreePath: string, pipelineId: string): Promise<RunInfo[]> {
        const pipeline = this.config.pipelines.find((item) => item.id === pipelineId);
        if (!pipeline) throw new Error(`Unknown pipeline: ${pipelineId}`);
        return runPipelineSteps(this, worktreePath, pipeline);
    }

    private async resolveCommand(
        command: WorktreeCommand,
        worktreePath: string,
        extraArgs: string[],
    ): Promise<ResolvedCommand> {
        const cwd = resolve(worktreePath, command.cwd ?? ".");
        const env = {
            ...process.env,
            WTS_REPO_ROOT: this.repoRoot,
            WTS_WORKTREE_PATH: worktreePath,
            WTS_CONFIG: join(this.repoRoot, "worktree-studio.json"),
            WTS_COMMAND_WRAPPER: Array.isArray(this.config.commandWrapper)
                ? this.config.commandWrapper.join(" ")
                : (this.config.commandWrapper ?? ""),
            ...command.env,
        };
        await this.applyPort(command, env, extraArgs);

        let file: string;
        let args: string[];
        if (command.packageScript) {
            file = this.packageManager;
            args = ["run", command.packageScript, ...extraArgs];
        } else if (command.command) {
            if (this.config.security?.allowArbitraryShell !== true) {
                throw new Error(`Command ${command.id} uses shell execution; set security.allowArbitraryShell to true`);
            }
            file = process.env.SHELL ?? "sh";
            args = [
                "-lc",
                extraArgs.length ? `${command.command} ${extraArgs.map(shellQuote).join(" ")}` : command.command,
            ];
        } else {
            throw new Error(`Command ${command.id} has no executable`);
        }

        const wrapped = applyWrapper(this.config.commandWrapper, file, args);
        return {
            file: wrapped.file,
            args: wrapped.args,
            cwd,
            env,
            displayCommand: [wrapped.file, ...wrapped.args].map(shellQuote).join(" "),
        };
    }

    private async applyPort(command: WorktreeCommand, env: NodeJS.ProcessEnv, extraArgs: string[]): Promise<void> {
        if (!command.port) return;
        if (typeof command.port === "number") {
            env.PORT = String(command.port);
            return;
        }
        const host = this.config.security?.bindHost ?? "127.0.0.1";
        const port = await findFreePort(host, command.port.range ?? [5173, 5999]);
        if (command.port.env) env[command.port.env] = String(port);
        for (const arg of command.port.args ?? []) {
            extraArgs.push(arg.replaceAll("{port}", String(port)));
        }
    }

    private appendLog(record: RunRecord, stream: RunLogEntry["stream"], text: string): void {
        const redacted = redact(text, this.config.security?.redactEnv ?? []);
        const entry: RunLogEntry = { time: new Date().toISOString(), stream, text: redacted };
        record.logs.push(entry);
        if (record.logs.length > 2000) record.logs.shift();
        record.logStream.write(`[${entry.time}] ${stream}: ${redacted}`);
        this.emit("log", { run: { ...record.info }, entry });
    }

    private emitRun(record: RunRecord): void {
        this.emit("run", { ...record.info });
    }
}

export async function runPipelineSteps(
    runner: ProcessRunner,
    worktreePath: string,
    pipeline: WorktreePipeline,
): Promise<RunInfo[]> {
    const results: RunInfo[] = [];
    for (const step of pipeline.steps) {
        const run = await runner.startRun({
            worktreePath,
            commandId: step.commandId,
            extraArgs: step.args,
        });
        const finished = await runner.waitForRun(run.id);
        results.push(finished);
        if (pipeline.stopOnFailure !== false && finished.status !== "succeeded") break;
    }
    return results;
}

function applyWrapper(
    wrapper: WorktreeStudioConfig["commandWrapper"],
    file: string,
    args: string[],
): { file: string; args: string[] } {
    if (!wrapper) return { file, args };
    const wrapperParts = Array.isArray(wrapper) ? wrapper : [wrapper];
    const [wrapperFile, ...wrapperArgs] = wrapperParts;
    return { file: wrapperFile, args: [...wrapperArgs, file, ...args] };
}

function shellQuote(value: string): string {
    if (/^[a-zA-Z0-9_./:=@-]+$/.test(value)) return value;
    return `'${value.replaceAll("'", "'\\''")}'`;
}

function redact(value: string, patterns: string[]): string {
    let result = value;
    for (const pattern of patterns) {
        const envPrefix = pattern.replaceAll("*", "");
        for (const [key, secret] of Object.entries(process.env)) {
            if (!secret || secret.length < 4) continue;
            if (matchesPattern(key, pattern) || (envPrefix && key.includes(envPrefix))) {
                result = result.replaceAll(secret, "[redacted]");
            }
        }
    }
    return result;
}

function matchesPattern(value: string, pattern: string): boolean {
    const regexp = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`, "i");
    return regexp.test(value);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ResolvedCommand {
    file: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    displayCommand: string;
}
