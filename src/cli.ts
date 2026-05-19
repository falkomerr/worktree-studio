#!/usr/bin/env node
import { realpath, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { ConfigError, configPath, defaultConfig, loadProjectConfig, saveProjectConfig } from "./config.js";
import { configuredAndDiscoveredCommands, discoverCommands, discoveredToConfig, findRepoRoot } from "./discovery.js";
import { listConfiguredWorktrees, listWorktrees, selectWorktree } from "./git.js";
import { ProcessRunner } from "./runner.js";
import { startGuiServer } from "./server.js";
import type { RunInfo, WorktreeStudioConfig } from "./types.js";

const args = process.argv.slice(2);

main().catch((error) => {
    if (error instanceof ConfigError) {
        console.error(error.issues.map((issue) => `- ${issue}`).join("\n"));
    } else {
        console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
});

async function main(): Promise<void> {
    const [command = "help", ...rest] = args;
    switch (command) {
        case "init":
            return init(rest);
        case "list":
        case "worktrees":
            return printWorktrees(rest);
        case "commands":
            return printCommands(rest);
        case "run":
            return runCommand(rest);
        case "pipeline":
            return runPipeline(rest);
        case "gui":
        case "ui":
            return runGui(rest);
        case "config":
            return configCommand(rest);
        case "agent-bootstrap":
            return printAgentBootstrap(rest);
        case "doctor":
            return doctor(rest);
        case "-h":
        case "--help":
        case "help":
            printHelp();
            return;
        case "-v":
        case "--version":
            console.log("0.1.0");
            return;
        default:
            throw new Error(`Unknown command: ${command}`);
    }
}

async function init(rest: string[]): Promise<void> {
    const repoRoot = resolveRepo(rest[0]);
    const force = rest.includes("--force");
    const loaded = await loadProjectConfig(repoRoot);
    if (loaded.exists && !force) {
        throw new Error(`${loaded.path} already exists. Use --force to overwrite.`);
    }
    const discovered = await discoverCommands(repoRoot);
    const defaults = defaultConfig(repoRoot);
    const config: WorktreeStudioConfig = {
        ...defaults,
        commands: discovered
            .filter((command) => command.packageScript && ["dev", "build", "preview", "test", "lint"].includes(command.type))
            .slice(0, 25)
            .map(discoveredToConfig),
        pipelines: [],
    };
    await saveProjectConfig(repoRoot, config as unknown as Record<string, unknown>);
    console.log(`Created ${configPath(repoRoot)}`);
}

async function printWorktrees(rest: string[]): Promise<void> {
    const repoRoot = resolveRepo(rest[0]);
    const { config } = await loadProjectConfig(repoRoot);
    const worktrees = await listConfiguredWorktrees(repoRoot, config);
    printTable(
        ["branch", "state", "ahead", "behind", "path"],
        worktrees.map((worktree) => [
            worktree.branch ?? "(detached)",
            worktree.prunable ? "prunable" : worktree.dirty ? "dirty" : "clean",
            String(worktree.ahead ?? 0),
            String(worktree.behind ?? 0),
            worktree.path,
        ]),
    );
}

async function printCommands(rest: string[]): Promise<void> {
    const repoRoot = resolveRepo(rest[0]);
    const [{ config }, discovered] = await Promise.all([loadProjectConfig(repoRoot), discoverCommands(repoRoot)]);
    const commands = configuredAndDiscoveredCommands(config, discovered);
    printTable(
        ["id", "type", "mode", "cwd", "source"],
        commands.map((command) => [
            command.id,
            command.type ?? "custom",
            command.mode ?? "one-shot",
            command.cwd ?? ".",
            command.discovered ? "discovered" : "config",
        ]),
    );
}

async function runCommand(rest: string[]): Promise<void> {
    const separator = rest.indexOf("--");
    const primary = separator >= 0 ? rest.slice(0, separator) : rest;
    const extraArgs = separator >= 0 ? rest.slice(separator + 1) : [];
    const [selector, commandId] = primary;
    if (!selector || !commandId) throw new Error("Usage: wts run <worktree> <command-id> [-- extra args]");
    const repoRoot = findRepoRoot(process.cwd());
    const loaded = await loadProjectConfig(repoRoot);
    const worktree = await findSelectedWorktree(repoRoot, selector);
    const runner = new ProcessRunner(repoRoot, loaded.config);
    attachConsoleLogs(runner);
    const run = await runner.startRun({ worktreePath: worktree.path, commandId, extraArgs });
    const finished = await runner.waitForRun(run.id);
    process.exitCode = finished.status === "succeeded" ? 0 : (finished.exitCode ?? 1);
}

async function runPipeline(rest: string[]): Promise<void> {
    const [selector, pipelineId] = rest;
    if (!selector || !pipelineId) throw new Error("Usage: wts pipeline <worktree> <pipeline-id>");
    const repoRoot = findRepoRoot(process.cwd());
    const loaded = await loadProjectConfig(repoRoot);
    const worktree = await findSelectedWorktree(repoRoot, selector);
    const runner = new ProcessRunner(repoRoot, loaded.config);
    attachConsoleLogs(runner);
    const runs = await runner.runPipeline(worktree.path, pipelineId);
    const failed = runs.find((run) => run.status !== "succeeded");
    printPipelineSummary(runs);
    process.exitCode = failed ? (failed.exitCode ?? 1) : 0;
}

async function runGui(rest: string[]): Promise<void> {
    const repoRoot = resolveRepo(firstPositional(rest, new Set(["--host", "--port"])));
    const host =
        readFlag(rest, "--host") ?? (await loadProjectConfig(repoRoot)).config.security?.bindHost ?? "127.0.0.1";
    const port = Number(readFlag(rest, "--port") ?? 0);
    const server = await startGuiServer(repoRoot, host, port);
    console.log(`Worktree Studio: ${server.url}`);
    console.log("Press Ctrl+C to stop the UI and all child processes.");
    const shutdown = async (): Promise<void> => {
        console.log("\nStopping Worktree Studio...");
        await server.close();
        process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    await new Promise(() => undefined);
}

function firstPositional(args: string[], flagsWithValues: Set<string>): string | undefined {
    for (let index = 0; index < args.length; index++) {
        const value = args[index];
        if (flagsWithValues.has(value)) {
            index++;
            continue;
        }
        if (!value.startsWith("--")) return value;
    }
    return undefined;
}

async function configCommand(rest: string[]): Promise<void> {
    if (rest[0] !== "validate") throw new Error("Usage: wts config validate [path]");
    const repoRoot = resolveRepo(rest[1]);
    const loaded = await loadProjectConfig(repoRoot);
    console.log(`${loaded.path}: ok (${loaded.exists ? loaded.revision : "defaults"})`);
}

async function printAgentBootstrap(rest: string[]): Promise<void> {
    const repoRoot = resolveRepo(rest[0]);
    const { config } = await loadProjectConfig(repoRoot);
    for (const section of config.agentBootstrap?.sections ?? []) {
        console.log(`# ${section.title}`);
        if (section.description) console.log(section.description);
        for (const command of section.commands) console.log(command);
        console.log("");
    }
}

async function doctor(rest: string[]): Promise<void> {
    const repoRoot = resolveRepo(rest[0]);
    const loaded = await loadProjectConfig(repoRoot);
    const [worktrees, discovered] = await Promise.all([listConfiguredWorktrees(repoRoot, loaded.config), discoverCommands(repoRoot)]);
    console.log(`repo: ${repoRoot}`);
    console.log(`config: ${loaded.exists ? loaded.path : "defaults only"}`);
    console.log(`configured commands: ${loaded.config.commands.length}`);
    console.log(`discovered commands: ${discovered.length}`);
    console.log(`worktrees: ${worktrees.length}`);
}

function printHelp(): void {
    console.log(`Worktree Studio

Usage:
  wts init [repo] [--force]
  wts list [repo]
  wts commands [repo]
  wts run <worktree> <command-id> [-- extra args]
  wts pipeline <worktree> <pipeline-id>
  wts gui [repo] [--host 127.0.0.1] [--port 0]
  wts config validate [repo]
  wts agent-bootstrap [repo]
  wts doctor [repo]`);
}

async function findSelectedWorktree(repoRoot: string, selector: string) {
    const worktrees = await listWorktrees(repoRoot);
    const worktree = selector === "." ? await findRepoWorktree(worktrees, repoRoot) : selectWorktree(worktrees, selector);
    if (!worktree) throw new Error(`Worktree not found: ${selector}`);
    return worktree;
}

async function findRepoWorktree(worktrees: Awaited<ReturnType<typeof listWorktrees>>, repoRoot: string) {
    const canonicalRepoRoot = await canonicalPath(repoRoot);
    for (const worktree of worktrees) {
        if ((await canonicalPath(worktree.path)) === canonicalRepoRoot) return worktree;
    }
    return undefined;
}

async function canonicalPath(path: string): Promise<string> {
    try {
        return await realpath(path);
    } catch {
        return resolve(path);
    }
}

function resolveRepo(inputPath?: string): string {
    return findRepoRoot(resolve(inputPath ?? process.cwd()));
}

function readFlag(args: string[], flag: string): string | undefined {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    return args[index + 1];
}

function attachConsoleLogs(runner: ProcessRunner): void {
    runner.on("log", ({ entry }: { entry: { stream: string; text: string } }) => {
        const target = entry.stream === "stderr" ? process.stderr : process.stdout;
        target.write(entry.text);
    });
}

function printPipelineSummary(runs: RunInfo[]): void {
    printTable(
        ["command", "status", "exit", "log"],
        runs.map((run) => [run.commandId, run.status, String(run.exitCode ?? ""), run.logFile]),
    );
}

function printTable(headers: string[], rows: string[][]): void {
    const widths = headers.map((header, index) =>
        Math.max(header.length, ...rows.map((row) => String(row[index] ?? "").length)),
    );
    console.log(headers.map((header, index) => header.padEnd(widths[index])).join("  "));
    console.log(widths.map((width) => "-".repeat(width)).join("  "));
    for (const row of rows) {
        console.log(row.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join("  "));
    }
}
