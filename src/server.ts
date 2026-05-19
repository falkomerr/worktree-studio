import { createReadStream } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectConfig, saveProjectConfig } from "./config.js";
import { configuredAndDiscoveredCommands, discoverCommands } from "./discovery.js";
import { listConfiguredWorktrees, listWorktrees, removeWorktree, selectWorktree } from "./git.js";
import { ProcessRunner } from "./runner.js";
import type { RunInfo, WorktreeStudioConfig } from "./types.js";

const MAX_JSON_BODY_BYTES = 1024 * 1024;

export interface GuiServer {
    url: string;
    token: string;
    close: () => Promise<void>;
}

class HttpError extends Error {
    public constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "HttpError";
    }
}

export async function startGuiServer(repoRoot: string, host: string, port: number): Promise<GuiServer> {
    let loadedConfig = await loadProjectConfig(repoRoot);
    const token = crypto.randomUUID();
    const runner = new ProcessRunner(repoRoot, loadedConfig.config);
    const clients = new Set<ServerResponse>();

    const publish = (event: string, data: unknown): void => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const client of clients) client.write(payload);
    };
    runner.on("run", (run) => publish("run", run));
    runner.on("log", (event) => publish("log", event));

    const server = http.createServer(async (request, response) => {
        try {
            if (!request.url) return sendJson(response, 404, { error: "Not found" });
            const url = new URL(request.url, `http://${request.headers.host ?? `${host}:${port}`}`);
            if (url.pathname.startsWith("/api/")) {
                if (!isAuthorized(request, url, token)) return sendJson(response, 401, { error: "Unauthorized" });
                if (!isAllowedOrigin(request)) return sendJson(response, 403, { error: "Origin rejected" });
                if (url.pathname === "/api/events") {
                    response.writeHead(200, {
                        "content-type": "text/event-stream",
                        "cache-control": "no-cache",
                        "connection": "keep-alive",
                    });
                    response.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
                    clients.add(response);
                    request.on("close", () => clients.delete(response));
                    return;
                }
                if (url.pathname === "/api/config" && request.method === "GET") {
                    loadedConfig = await loadProjectConfig(repoRoot);
                    return sendJson(response, 200, loadedConfig);
                }
                if (url.pathname === "/api/config" && request.method === "PUT") {
                    const body = await readJsonBody(request);
                    const revision = typeof body.revision === "string" ? body.revision : undefined;
                    const nextRaw = body.config && typeof body.config === "object" ? body.config : body;
                    loadedConfig = await saveProjectConfig(repoRoot, nextRaw as Record<string, unknown>, revision);
                    publish("config", loadedConfig);
                    return sendJson(response, 200, loadedConfig);
                }
                if (url.pathname === "/api/discovery/scripts") {
                    const discovered = await discoverCommands(repoRoot);
                    return sendJson(response, 200, {
                        discovered,
                        commands: configuredAndDiscoveredCommands(loadedConfig.config, discovered),
                    });
                }
                if (url.pathname === "/api/worktrees" && request.method === "GET") {
                    return sendJson(response, 200, { worktrees: await listGuiWorktrees(repoRoot, loadedConfig.config) });
                }
                if (url.pathname === "/api/worktrees" && request.method === "DELETE") {
                    const body = await readJsonBody(request);
                    const worktree = await resolveWorktree(repoRoot, String(body.worktree ?? "."));
                    if ((await canonicalPath(worktree.path)) === (await canonicalPath(repoRoot))) {
                        throw new HttpError(400, "Cannot remove the repository root worktree");
                    }
                    const removal = await removeWorktree(repoRoot, worktree.path);
                    return sendJson(response, 200, {
                        removed: worktree,
                        savedCommit: removal.savedCommit,
                        worktrees: await listGuiWorktrees(repoRoot, loadedConfig.config),
                    });
                }
                if (url.pathname === "/api/runs" && request.method === "GET") {
                    return sendJson(response, 200, { runs: runner.listRuns() });
                }
                if (url.pathname === "/api/runs" && request.method === "POST") {
                    const body = await readJsonBody(request);
                    const worktree = await resolveWorktree(repoRoot, String(body.worktree ?? "."));
                    const run = await runner.startRun({
                        worktreePath: worktree.path,
                        commandId: String(body.commandId),
                        extraArgs: Array.isArray(body.args) ? body.args.map(String) : [],
                    });
                    return sendJson(response, 201, { run });
                }
                const runLogsMatch = /^\/api\/runs\/([^/]+)\/logs$/.exec(url.pathname);
                if (runLogsMatch && request.method === "GET") {
                    return sendJson(response, 200, { logs: runner.getLogs(runLogsMatch[1]) });
                }
                const runMatch = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
                if (runMatch && request.method === "DELETE") {
                    return sendJson(response, 200, { stopped: runner.stopRun(runMatch[1]) });
                }
                const pipelineMatch = /^\/api\/pipelines\/([^/]+)\/run$/.exec(url.pathname);
                if (pipelineMatch && request.method === "POST") {
                    const body = await readJsonBody(request);
                    const worktree = await resolveWorktree(repoRoot, String(body.worktree ?? "."));
                    const runs = await runner.runPipeline(worktree.path, pipelineMatch[1]);
                    return sendJson(response, 201, { runs });
                }
                if (url.pathname === "/api/agent-bootstrap") {
                    return sendJson(response, 200, loadedConfig.config.agentBootstrap ?? { sections: [] });
                }
                return sendJson(response, 404, { error: "Not found" });
            }
            return serveStatic(response, url.pathname);
        } catch (error) {
            if (error instanceof HttpError) return sendJson(response, error.status, { error: error.message });
            return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve());
    });
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    const url = `http://${host}:${actualPort}/?token=${encodeURIComponent(token)}`;
    return {
        url,
        token,
        close: async () => {
            await runner.stopAll();
            for (const client of clients) client.end();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        },
    };
}

async function resolveWorktree(repoRoot: string, selector: string) {
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

async function listGuiWorktrees(repoRoot: string, config: WorktreeStudioConfig) {
    const worktrees = await listConfiguredWorktrees(repoRoot, config);
    const canonicalCurrentRoot = await canonicalPath(repoRoot);
    const canonicalMainRoot = worktrees[0] ? await canonicalPath(worktrees[0].path) : canonicalCurrentRoot;
    return Promise.all(
        worktrees.map(async (worktree) => {
            const canonicalWorktree = await canonicalPath(worktree.path);
            const isMain = canonicalWorktree === canonicalMainRoot;
            const isCurrent = canonicalWorktree === canonicalCurrentRoot;
            return {
                ...worktree,
                isMain,
                isCurrent,
                removable: !worktree.bare && !isMain && !isCurrent,
            };
        }),
    );
}

async function canonicalPath(path: string): Promise<string> {
    try {
        return await realpath(path);
    } catch {
        return resolve(path);
    }
}

function isAuthorized(request: IncomingMessage, url: URL, token: string): boolean {
    return request.headers["x-wts-token"] === token || url.searchParams.get("token") === token;
}

function isAllowedOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    if (!origin) return true;
    try {
        const parsed = new URL(origin);
        return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
    } catch {
        return false;
    }
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const contentType = request.headers["content-type"];
    if (contentType && !isJsonContentType(contentType)) {
        throw new HttpError(415, "Expected application/json request body");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_JSON_BODY_BYTES) throw new HttpError(413, "JSON request body is too large");
        chunks.push(buffer);
    }
    if (!chunks.length) return {};
    try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new HttpError(400, "JSON request body must be an object");
        }
        return parsed as Record<string, unknown>;
    } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, "Invalid JSON request body");
    }
}

function isJsonContentType(value: string | string[]): boolean {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw.split(";")[0].trim().toLowerCase() === "application/json";
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body, null, 2));
}

async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
    const webRoot = fileURLToPath(new URL("./web/", import.meta.url));
    const requested = pathname === "/" ? "index.html" : pathname.slice(1);
    const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
    const filePath = join(webRoot, safePath);
    try {
        await readFile(filePath);
        response.writeHead(200, { "content-type": contentType(filePath) });
        createReadStream(filePath).pipe(response);
    } catch {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
    }
}

function contentType(path: string): string {
    switch (extname(path)) {
        case ".html":
            return "text/html; charset=utf-8";
        case ".css":
            return "text/css; charset=utf-8";
        case ".js":
            return "text/javascript; charset=utf-8";
        case ".json":
            return "application/json; charset=utf-8";
        default:
            return "application/octet-stream";
    }
}
