const params = new URLSearchParams(location.search);
const token = params.get("token") || localStorage.getItem("wts-token") || "";
if (token) localStorage.setItem("wts-token", token);

const endpoints = [
    "/api/config",
    "/api/discovery/scripts",
    "/api/worktrees",
    "/api/runs",
    "/api/events",
    "/api/agent-bootstrap",
    "/api/pipelines/:id/run",
];

const fallback = {
    config: {
        project: { name: "Worktree Studio", defaultBranch: "main" },
        commands: [
            {
                id: "build",
                label: "Build",
                type: "build",
                mode: "one-shot",
                cwd: ".",
                shell: "bun run build",
                visible: true,
            },
            { id: "test", label: "Test", type: "test", mode: "one-shot", cwd: ".", shell: "bun test", visible: true },
            {
                id: "lint",
                label: "Lint",
                type: "lint",
                mode: "one-shot",
                cwd: ".",
                shell: "bun run lint",
                visible: true,
            },
        ],
    },
    worktrees: [
        {
            path: "/workspace/main",
            branch: "main",
            dirty: false,
            ahead: 0,
            behind: 0,
            status: "ready",
            lastRun: "build succeeded",
        },
        {
            path: "/workspace/control-room",
            branch: "feature/control-room",
            dirty: true,
            ahead: 2,
            behind: 0,
            status: "dirty",
            lastRun: "lint running",
        },
        {
            path: "/workspace/release",
            branch: "release/next",
            dirty: false,
            ahead: 1,
            behind: 3,
            status: "failed",
            lastRun: "test failed",
        },
    ],
    runs: [
        {
            id: "run-1024",
            commandLabel: "Build",
            worktreePath: "/workspace/control-room",
            status: "running",
            logFile: "logs/run-1024.log",
            commandId: "build",
        },
        {
            id: "run-1023",
            commandLabel: "Test",
            worktreePath: "/workspace/main",
            status: "succeeded",
            logFile: "logs/run-1023.log",
            commandId: "test",
        },
        {
            id: "run-1022",
            commandLabel: "Lint",
            worktreePath: "/workspace/release",
            status: "failed",
            logFile: "logs/run-1022.log",
            commandId: "lint",
        },
    ],
    bootstrap: {
        sections: [
            {
                title: "Session contract",
                description:
                    "Read project instructions, inspect git status, preserve unrelated changes, and verify before handoff.",
                commands: ["git status --short", "bd ready", "bun test"],
            },
        ],
    },
};

const state = {
    configEnvelope: null,
    config: null,
    discovered: [],
    commands: [],
    worktrees: [],
    runs: [],
    logs: [],
    bootstrap: null,
    selectedRun: null,
    selectedWorktreePath: "",
    selectedCommandId: "",
    query: "",
    worktreeFilter: "all",
    runFilter: "all",
    eventSource: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

boot();

function boot() {
    $$(".nav-item").forEach((button) => {
        button.addEventListener("click", () => activateView(button.dataset.view));
    });

    $$("[data-view-jump]").forEach((button) => {
        button.addEventListener("click", () => activateView(button.dataset.viewJump));
    });

    $("#refresh-button").addEventListener("click", refresh);
    $("#run-button").addEventListener("click", runTopbarCommand);
    $("#run-edited-command").addEventListener("click", runEditedCommand);
    $("#save-settings").addEventListener("click", saveSettings);
    $("#revert-settings").addEventListener("click", refreshConfig);
    $("#format-settings").addEventListener("click", formatSettings);
    $("#add-command").addEventListener("click", addCommandFromForm);
    $("#import-discovered").addEventListener("click", importSelectedDiscovered);
    $("#copy-command").addEventListener("click", copyEditedCommand);
    $("#clear-log-view").addEventListener("click", () => {
        state.logs = [];
        renderLogs();
    });
    $("#filter-input").addEventListener("input", (event) => {
        state.query = event.target.value.trim().toLowerCase();
        render();
    });
    $("#run-filter").addEventListener("change", (event) => {
        state.runFilter = event.target.value;
        renderRuns();
    });
    $("#settings-json").addEventListener("input", validateSettings);
    $("#agent-profile").addEventListener("change", renderAgentBootstrap);
    $("#agent-worktree").addEventListener("change", renderAgentBootstrap);
    $("#agent-mission").addEventListener("input", renderAgentBootstrap);
    $("#regenerate-agent-bootstrap").addEventListener("click", renderAgentBootstrap);
    $("#copy-agent-bootstrap").addEventListener("click", () => copyText($("#agent-bootstrap").textContent));

    $$(".segment[data-worktree-filter]").forEach((button) => {
        button.addEventListener("click", () => {
            state.worktreeFilter = button.dataset.worktreeFilter;
            $$(".segment[data-worktree-filter]").forEach((item) => item.classList.remove("active"));
            button.classList.add("active");
            renderWorktrees();
        });
    });

    connectEvents();
    refresh();
}

async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (token) headers.set("x-wts-token", token);
    if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const url = token ? `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : path;
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function refresh() {
    $("#connection-state").textContent = "loading";
    clearNotice();
    const results = await Promise.allSettled([
        refreshConfig(),
        refreshDiscovery(),
        refreshWorktrees(),
        refreshRuns(),
        refreshBootstrap(),
    ]);
    const online = results.some((result) => result.status === "fulfilled" && result.value === "api");
    $("#connection-state").textContent = online ? "connected" : "offline";
    $("#data-state").textContent = online ? "api" : "fallback";
    if (!online)
        showNotice("Backend endpoints are unavailable. Static fallback data is displayed until refresh succeeds.");
    ensureSelection();
    render();
}

async function refreshConfig() {
    try {
        const payload = await api("/api/config");
        state.configEnvelope = isObject(payload) && "config" in payload ? payload : { config: payload, exists: true };
        state.config = state.configEnvelope.config || {};
        $("#settings-json").value = JSON.stringify(state.config, null, 4);
        validateSettings();
        return "api";
    } catch (error) {
        state.configEnvelope = { config: clone(fallback.config), exists: false };
        state.config = state.configEnvelope.config;
        $("#settings-json").value = JSON.stringify(state.config, null, 4);
        validateSettings();
        return "fallback";
    }
}

async function refreshDiscovery() {
    try {
        const payload = await api("/api/discovery/scripts");
        state.discovered = normalizeCommands(payload?.discovered || payload?.scripts || payload?.items || []);
        state.commands = normalizeCommands(payload?.commands || payload?.configured || configCommands());
        if (!state.commands.length) state.commands = normalizeCommands(fallback.config.commands);
        return "api";
    } catch (error) {
        state.discovered = normalizeCommands(fallback.config.commands);
        state.commands = normalizeCommands(configCommands()).length
            ? normalizeCommands(configCommands())
            : normalizeCommands(fallback.config.commands);
        return "fallback";
    }
}

async function refreshWorktrees() {
    try {
        const payload = await api("/api/worktrees");
        state.worktrees = normalizeWorktrees(payload?.worktrees || payload?.items || payload || []);
        if (!state.worktrees.length) state.worktrees = normalizeWorktrees(fallback.worktrees);
        return "api";
    } catch (error) {
        state.worktrees = normalizeWorktrees(fallback.worktrees);
        return "fallback";
    }
}

async function refreshRuns() {
    try {
        const payload = await api("/api/runs");
        state.runs = normalizeRuns(payload?.runs || payload?.items || payload || []);
        if (!state.runs.length) state.runs = normalizeRuns(fallback.runs);
        return "api";
    } catch (error) {
        state.runs = normalizeRuns(fallback.runs);
        return "fallback";
    }
}

async function refreshBootstrap() {
    try {
        const payload = await api("/api/agent-bootstrap");
        state.bootstrap =
            typeof payload === "string" ? { sections: [{ title: "Backend template", commands: [payload] }] } : payload;
        return "api";
    } catch (error) {
        state.bootstrap = clone(fallback.bootstrap);
        return "fallback";
    }
}

function connectEvents() {
    const url = token ? `/api/events?token=${encodeURIComponent(token)}` : "/api/events";
    try {
        state.eventSource = new EventSource(url);
        state.eventSource.onopen = () => {
            $("#event-state").textContent = "live";
        };
        state.eventSource.addEventListener("run", (event) => {
            upsertRun(normalizeRun(JSON.parse(event.data), 0));
            renderRuns();
        });
        state.eventSource.addEventListener("log", (event) => {
            const payload = JSON.parse(event.data);
            pushLog(
                payload.entry?.stream || payload.stream || "log",
                payload.entry?.text || payload.text || event.data,
            );
        });
        state.eventSource.onmessage = (event) => pushLog("event", parseMessage(event.data));
        state.eventSource.onerror = () => {
            $("#event-state").textContent = "retrying";
        };
    } catch (error) {
        $("#event-state").textContent = "unavailable";
    }
}

function render() {
    $("#project-title").textContent = state.config?.project?.name || "Worktree Studio";
    renderSelectors();
    renderDashboard();
    renderWorktrees();
    renderRuns();
    renderSettingsMeta();
    renderCommands();
    renderAgentSelectors();
    renderAgentBootstrap();
}

function renderSelectors() {
    $("#worktree-select").innerHTML = state.worktrees
        .map(
            (worktree) =>
                `<option value="${escapeHtml(worktree.path)}">${escapeHtml(worktree.branch || basename(worktree.path))}</option>`,
        )
        .join("");
    $("#command-select").innerHTML = state.commands
        .filter((command) => command.visible !== false)
        .map(
            (command) =>
                `<option value="${escapeHtml(command.id)}">${escapeHtml(command.label || command.id)}</option>`,
        )
        .join("");
    if (state.selectedWorktreePath) $("#worktree-select").value = state.selectedWorktreePath;
    if (state.selectedCommandId) $("#command-select").value = state.selectedCommandId;
}

function renderDashboard() {
    const dirty = state.worktrees.filter((worktree) => worktree.dirty).length;
    const running = state.runs.filter((run) => run.status === "running").length;
    const failed = state.runs.filter((run) => run.status === "failed").length;
    $("#summary-cards").innerHTML = [
        metric("Worktrees", state.worktrees.length, `${dirty} dirty`),
        metric("Running", running, `${failed} failed`),
        metric("Commands", state.commands.length, `${state.discovered.length} discovered`),
        metric("Events", state.logs.length, $("#event-state").textContent),
    ].join("");
    $("#rail-map").innerHTML =
        filteredWorktrees().slice(0, 5).map(renderRailLine).join("") ||
        emptyState("No worktrees match the current filter.");
    $("#dashboard-runs").innerHTML =
        filteredRuns()
            .slice(0, 4)
            .map((run) => renderRun(run, false))
            .join("") || emptyState("No runs discovered yet.");
}

function renderWorktrees() {
    $("#worktree-map").innerHTML =
        filteredWorktrees().map(renderWorktreeLane).join("") || emptyState("No worktrees match the current filter.");
    $$("#worktree-map .worktree-lane").forEach((button) => {
        button.addEventListener("click", () => {
            state.selectedWorktreePath = button.dataset.path;
            renderWorktrees();
            renderSelectors();
            renderAgentSelectors();
            renderAgentBootstrap();
        });
    });
    const selected = selectedWorktree();
    $("#worktree-detail").innerHTML = selected ? renderWorktreeDetail(selected) : emptyState("Select a worktree lane.");
}

function renderRuns() {
    $("#runs-list").innerHTML =
        filteredRuns()
            .map((run) => renderRun(run, true))
            .join("") || emptyState("No runs match the current filter.");
    $$("#runs-list .run-item").forEach((button) => {
        button.addEventListener("click", async () => {
            state.selectedRun = button.dataset.run;
            try {
                const response = await api(`/api/runs/${button.dataset.run}/logs`);
                state.logs = Array.isArray(response?.logs) ? response.logs : [];
            } catch {
                pushLog("system", `logs endpoint unavailable for ${button.dataset.run}`);
            }
            renderRuns();
            renderLogs();
        });
    });
    renderLogs();
}

function renderSettingsMeta() {
    $("#settings-state").textContent = state.configEnvelope?.exists
        ? `saved ${state.configEnvelope.revision || ""}`.trim()
        : "fallback";
    $("#endpoint-list").innerHTML = endpoints
        .map(
            (endpoint) =>
                `<div class="item"><strong>${escapeHtml(endpoint)}</strong><span>${endpointKind(endpoint)}</span></div>`,
        )
        .join("");
}

function renderCommands() {
    const commands = filteredCommands();
    $("#command-list").innerHTML =
        commands.map(renderCommand).join("") || emptyState("No commands match the current filter.");
    $$("#command-list .command-item").forEach((button) => {
        button.addEventListener("click", () => {
            const command = state.commands.find((item) => item.id === button.dataset.command);
            fillCommandForm(command);
            state.selectedCommandId = command?.id || "";
            renderCommands();
            renderSelectors();
            renderAgentBootstrap();
        });
    });
    if (!$("#cmd-id").value && state.commands[0]) fillCommandForm(state.commands[0]);
}

function renderAgentSelectors() {
    $("#agent-worktree").innerHTML = state.worktrees
        .map(
            (worktree) =>
                `<option value="${escapeHtml(worktree.path)}">${escapeHtml(worktree.branch || basename(worktree.path))}</option>`,
        )
        .join("");
    if (state.selectedWorktreePath) $("#agent-worktree").value = state.selectedWorktreePath;
}

function renderAgentBootstrap() {
    const worktree = state.worktrees.find((item) => item.path === $("#agent-worktree").value) || selectedWorktree();
    const command = state.commands.find((item) => item.id === state.selectedCommandId) || state.commands[0];
    const sections = Array.isArray(state.bootstrap?.sections) ? state.bootstrap.sections : [];
    const template = sections
        .map((section) => {
            const lines = Array.isArray(section.commands) ? section.commands : [];
            return [`## ${section.title || "Template"}`, section.description || "", ...lines]
                .filter(Boolean)
                .join("\n");
        })
        .join("\n\n");
    $("#agent-bootstrap").textContent = [
        "# Worktree Studio Agent Bootstrap",
        "",
        `Profile: ${$("#agent-profile").value}`,
        `Worktree: ${worktree ? `${worktree.branch || "detached"} (${worktree.path})` : "not selected"}`,
        `Command: ${command ? commandLine(command) : "none"}`,
        "",
        "## Mission",
        $("#agent-mission").value.trim(),
        "",
        "## Backend Template",
        template || "No /api/agent-bootstrap template loaded.",
        "",
        "## Current Signals",
        `Runs: ${state.runs.length}`,
        `Open logs: ${state.logs.length}`,
        `Dirty worktrees: ${state.worktrees.filter((item) => item.dirty).length}`,
        "",
        "## Guardrails",
        "- Read local instructions before editing.",
        "- Inspect git status and preserve unrelated changes.",
        "- Keep changes scoped to the current task.",
        "- Run focused verification before handoff.",
    ].join("\n");
}

function renderRailLine(worktree, index) {
    const status = worktreeStatus(worktree);
    const fill = 22 + ((index * 19 + String(worktree.path).length) % 70);
    return `<div class="rail-line">
        <strong>${escapeHtml(worktree.branch || "detached")}</strong>
        <div class="rail-track" style="--fill:${fill}%"></div>
        ${pill(status)}
    </div>`;
}

function renderWorktreeLane(worktree) {
    const status = worktreeStatus(worktree);
    const active = worktree.path === state.selectedWorktreePath ? " active" : "";
    return `<button class="worktree-lane${active}" data-path="${escapeHtml(worktree.path)}">
        <strong>${escapeHtml(worktree.branch || "detached")}</strong>
        <span class="muted">${escapeHtml(worktree.path)}</span>
        <span>${pill(status)} ${pill(worktree.dirty ? "dirty" : "clean")}</span>
    </button>`;
}

function renderWorktreeDetail(worktree) {
    const rows = [
        ["Path", worktree.path],
        ["Branch", worktree.branch || "detached"],
        ["Status", worktreeStatus(worktree)],
        ["Ahead / behind", `${worktree.ahead || 0} / ${worktree.behind || 0}`],
        ["Last run", worktree.lastRun || "none"],
    ];
    return `<div class="detail-list">${rows
        .map(
            ([label, value]) =>
                `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
        )
        .join("")}</div>
        <button class="primary-button wide" data-view-jump="commands">Prepare command</button>`;
}

function renderRun(run, interactive) {
    const active = run.id === state.selectedRun ? " active" : "";
    const tag = interactive ? "button" : "article";
    const type = interactive ? 'type="button"' : "";
    return `<${tag} class="item run-item${active}" ${type} data-run="${escapeHtml(run.id)}">
        <div class="item-row"><strong>${escapeHtml(run.commandLabel || run.commandId || run.id)}</strong>${pill(run.status)}</div>
        <span>${escapeHtml(run.worktreePath || "unknown worktree")}</span>
        <span class="muted">${escapeHtml(run.logFile || run.id)}</span>
    </${tag}>`;
}

function renderCommand(command) {
    const active = command.id === state.selectedCommandId ? " active" : "";
    return `<button class="item command-item${active}" type="button" data-command="${escapeHtml(command.id)}">
        <div class="item-row"><strong>${escapeHtml(command.label || command.id)}</strong><span>${escapeHtml(command.type || "custom")}</span></div>
        <span>${escapeHtml(commandLine(command))}</span>
        <span class="muted">${escapeHtml(command.cwd || ".")} / ${escapeHtml(command.mode || "one-shot")}</span>
    </button>`;
}

function renderLogs() {
    const selected = state.runs.find((run) => run.id === state.selectedRun);
    $("#selected-run-label").textContent = selected
        ? `${selected.commandLabel || selected.id} on ${selected.worktreePath}`
        : "combined event stream";
    $("#log-output").textContent = state.logs.length
        ? state.logs
              .map(
                  (entry) =>
                      `[${entry.time || new Date().toISOString()}] ${entry.stream || "log"}: ${entry.text || entry}`,
              )
              .join("")
        : "No log events yet. Run a pipeline or connect /api/events to populate this stream.";
    if ($("#autoscroll").checked) $("#log-output").scrollTop = $("#log-output").scrollHeight;
}

async function runTopbarCommand() {
    await runCommand($("#command-select").value, $("#worktree-select").value);
}

async function runEditedCommand() {
    await runCommand($("#cmd-id").value.trim() || state.selectedCommandId, $("#worktree-select").value);
}

async function runCommand(commandId, worktreePath) {
    const command = state.commands.find((item) => item.id === commandId);
    pushLog("queued", `POST /api/runs ${commandLine(command || { id: commandId })}`);
    try {
        const response = await api("/api/runs", {
            method: "POST",
            body: JSON.stringify({ worktree: worktreePath, commandId }),
        });
        if (response?.run) upsertRun(normalizeRun(response.run, 0));
        pushLog("run", `accepted ${commandId}`);
        render();
    } catch (error) {
        pushLog("fallback", `run endpoint unavailable: ${error.message}`);
        showNotice("Run endpoint is unavailable. Save new or edited commands before launching them.");
    }
}

async function saveSettings() {
    let config;
    try {
        config = JSON.parse($("#settings-json").value);
    } catch (error) {
        $("#settings-state").textContent = error.message;
        return;
    }
    const body =
        state.configEnvelope && "revision" in state.configEnvelope
            ? { config, revision: state.configEnvelope.revision }
            : config;
    $("#save-settings").disabled = true;
    try {
        const response = await api("/api/config", { method: "PUT", body: JSON.stringify(body) });
        state.configEnvelope =
            isObject(response) && "config" in response ? response : { config: response || config, exists: true };
        state.config = state.configEnvelope.config;
        $("#settings-json").value = JSON.stringify(state.config, null, 4);
        validateSettings();
        render();
        showNotice("Configuration saved.");
    } catch (error) {
        showNotice(`Could not save /api/config: ${error.message}`);
    } finally {
        $("#save-settings").disabled = false;
    }
}

function addCommandFromForm() {
    const config = JSON.parse($("#settings-json").value || "{}");
    const commands = Array.isArray(config.commands) ? config.commands : [];
    commands.push(commandPayloadFromForm());
    config.commands = commands;
    $("#settings-json").value = JSON.stringify(config, null, 4);
    $("#settings-state").textContent = "dirty";
    validateSettings();
}

function importSelectedDiscovered() {
    const command = state.discovered[0] || state.commands[0];
    if (!command) return;
    fillCommandForm(command);
}

function fillCommandForm(command) {
    if (!command) return;
    $("#cmd-id").value = command.id || "";
    $("#cmd-label").value = command.label || command.id || "";
    $("#cmd-type").value = command.type || "custom";
    $("#cmd-mode").value = command.mode || "one-shot";
    $("#cmd-cwd").value = command.cwd || ".";
    $("#cmd-script").value = command.packageScript || "";
    $("#cmd-shell").value = command.shell || command.command || "";
}

function commandPayloadFromForm() {
    return {
        id: $("#cmd-id").value.trim(),
        label: $("#cmd-label").value.trim(),
        type: $("#cmd-type").value,
        mode: $("#cmd-mode").value,
        cwd: $("#cmd-cwd").value.trim() || ".",
        packageScript: $("#cmd-script").value.trim() || undefined,
        command: $("#cmd-shell").value.trim() || undefined,
        visible: true,
    };
}

function copyEditedCommand() {
    copyText(commandLine(commandPayloadFromForm()));
}

function formatSettings() {
    try {
        $("#settings-json").value = JSON.stringify(JSON.parse($("#settings-json").value), null, 4);
    } finally {
        validateSettings();
    }
}

function validateSettings() {
    try {
        const parsed = JSON.parse($("#settings-json").value);
        const count = Object.keys(parsed || {}).length;
        $("#settings-state").textContent = "valid";
        $("#settings-validation").innerHTML = `${pill("valid")}<span>${count} top-level keys</span>`;
        return true;
    } catch (error) {
        $("#settings-state").textContent = "invalid";
        $("#settings-validation").innerHTML = `${pill("failed")}<span>${escapeHtml(error.message)}</span>`;
        return false;
    }
}

function activateView(viewId) {
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
}

function ensureSelection() {
    if (!state.selectedWorktreePath && state.worktrees[0]) state.selectedWorktreePath = state.worktrees[0].path;
    if (!state.selectedCommandId && state.commands[0]) state.selectedCommandId = state.commands[0].id;
    if (!state.selectedRun && state.runs[0]) state.selectedRun = state.runs[0].id;
}

function filteredWorktrees() {
    return state.worktrees.filter((worktree) => {
        const status = worktreeStatus(worktree);
        const matchesQuery = queryMatches([worktree.path, worktree.branch, status, worktree.lastRun]);
        if (!matchesQuery) return false;
        if (state.worktreeFilter === "dirty") return worktree.dirty || status === "dirty";
        if (state.worktreeFilter === "ready")
            return !worktree.dirty && ["clean", "ready", "succeeded"].includes(status);
        return true;
    });
}

function filteredRuns() {
    return state.runs.filter((run) => {
        const status = normalizeStatus(run.status);
        const matchesState = state.runFilter === "all" || status === state.runFilter;
        return matchesState && queryMatches([run.id, run.commandLabel, run.worktreePath, status]);
    });
}

function filteredCommands() {
    return state.commands.filter((command) =>
        queryMatches([command.id, command.label, command.type, commandLine(command), command.cwd]),
    );
}

function queryMatches(values) {
    if (!state.query) return true;
    return values.some((value) =>
        String(value || "")
            .toLowerCase()
            .includes(state.query),
    );
}

function selectedWorktree() {
    return state.worktrees.find((item) => item.path === state.selectedWorktreePath) || state.worktrees[0];
}

function normalizeCommands(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item, index) => {
        if (typeof item === "string") {
            return {
                id: slug(item) || `command-${index}`,
                label: item,
                shell: item,
                cwd: ".",
                mode: "one-shot",
                type: "custom",
                visible: true,
            };
        }
        const id =
            item.id ||
            item.name ||
            item.label ||
            item.packageScript ||
            item.command ||
            item.shell ||
            `command-${index}`;
        return {
            id: String(id),
            label: String(item.label || item.name || id),
            type: String(item.type || "custom"),
            mode: String(item.mode || "one-shot"),
            cwd: String(item.cwd || item.path || "."),
            shell: item.shell || item.command || "",
            packageScript: item.packageScript || item.script || "",
            visible: item.visible !== false,
        };
    });
}

function normalizeWorktrees(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
        path: String(item.path || item.cwd || item.id || ""),
        branch: String(item.branch || item.ref || item.name || "detached"),
        dirty: Boolean(item.dirty || item.dirtyFiles || item.changes),
        ahead: Number(item.ahead || 0),
        behind: Number(item.behind || 0),
        prunable: Boolean(item.prunable),
        status: normalizeStatus(item.status || (item.dirty ? "dirty" : "clean")),
        lastRun: String(item.lastRun || item.last_run || ""),
    }));
}

function normalizeRuns(items) {
    if (!Array.isArray(items)) return [];
    return items.map(normalizeRun);
}

function normalizeRun(item, index) {
    return {
        id: String(item.id || item.runId || `run-${index}`),
        commandLabel: String(item.commandLabel || item.command || item.pipeline || item.commandId || `run-${index}`),
        commandId: String(item.commandId || item.pipelineId || item.command || ""),
        worktreePath: String(item.worktreePath || item.worktree || item.cwd || ""),
        status: normalizeStatus(item.status || "running"),
        logFile: String(item.logFile || item.log_file || ""),
    };
}

function configCommands() {
    const commands = state.config?.commands;
    if (Array.isArray(commands)) return commands;
    if (commands && typeof commands === "object") {
        return Object.entries(commands).map(([id, value]) =>
            typeof value === "string" ? { id, label: id, shell: value } : { id, ...value },
        );
    }
    return [];
}

function worktreeStatus(worktree) {
    if (worktree.prunable) return "prunable";
    if (worktree.dirty) return "dirty";
    return normalizeStatus(worktree.status || "clean");
}

function normalizeStatus(status) {
    const value = String(status || "").toLowerCase();
    if (["success", "passed", "pass", "ok", "clean"].includes(value)) return "succeeded";
    if (["ready", "idle"].includes(value)) return "ready";
    if (["fail", "failed", "error"].includes(value)) return "failed";
    if (["queued", "pending"].includes(value)) return "queued";
    return value || "ready";
}

function metric(label, value, detail) {
    return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></article>`;
}

function pill(status) {
    const normalized = normalizeStatus(status);
    return `<span class="pill status-${escapeHtml(normalized)}"><span class="status-dot"></span>${escapeHtml(status)}</span>`;
}

function emptyState(message) {
    return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function endpointKind(endpoint) {
    if (endpoint === "/api/events") return "SSE";
    if (endpoint === "/api/config") return "GET / PUT";
    if (endpoint.includes(":id")) return "POST";
    return "GET";
}

function commandLine(command) {
    if (!command) return "";
    if (command.shell) return command.shell;
    if (command.command) return command.command;
    if (command.packageScript) return `bun run ${command.packageScript}`;
    return command.id || "";
}

function upsertRun(run) {
    const index = state.runs.findIndex((item) => item.id === run.id);
    if (index >= 0) state.runs[index] = run;
    else state.runs.unshift(run);
}

function pushLog(stream, text) {
    state.logs.push({ time: new Date().toISOString(), stream, text });
    state.logs = state.logs.slice(-400);
    renderLogs();
}

function parseMessage(data) {
    try {
        const parsed = JSON.parse(data);
        return parsed.message || parsed.text || data;
    } catch {
        return data;
    }
}

function basename(path) {
    return String(path).split(/[\\/]/).filter(Boolean).pop() || path;
}

function slug(value) {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function clearNotice() {
    $("#notice").hidden = true;
    $("#notice").textContent = "";
}

function showNotice(message) {
    $("#notice").hidden = false;
    $("#notice").textContent = message;
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
}

async function copyText(text) {
    try {
        await navigator.clipboard?.writeText(text || "");
        showNotice("Copied to clipboard.");
    } catch {
        showNotice("Clipboard is unavailable in this browser context.");
    }
}
