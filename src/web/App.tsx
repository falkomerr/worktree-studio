import {
    AlertCircleIcon,
    CheckCircle2Icon,
    CircleIcon,
    FolderGit2Icon,
    HistoryIcon,
    Loader2Icon,
    PlayIcon,
    PlusIcon,
    RefreshCwIcon,
    SaveIcon,
    Settings2Icon,
    TerminalSquareIcon,
    Trash2Icon,
    XCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty";
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

type CommandMode = "one-shot" | "long-running";
type CommandType = "dev" | "build" | "preview" | "test" | "lint" | "pipeline" | "custom";
type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "ready" | string;

interface WorktreeAction {
    id: string;
    label: string;
    type?: CommandType | string;
    kind?: "package-script" | "shell" | string;
    command?: string;
    shell?: string;
    packageScript?: string;
    cwd?: string;
    mode?: CommandMode | string;
    visible?: boolean;
    confirm?: boolean;
    discovered?: boolean;
}

interface WorktreeInfo {
    path: string;
    branch?: string;
    dirty?: boolean;
    status?: string;
    statusLine?: string;
    ahead?: number;
    behind?: number;
    prunable?: boolean;
    detached?: boolean;
    locked?: string;
    reason?: string;
    lastRun?: string;
    removable?: boolean;
}

interface RunInfo {
    id: string;
    commandId: string;
    commandLabel: string;
    worktreePath: string;
    cwd?: string;
    status: RunStatus;
    startedAt?: string;
    endedAt?: string;
    exitCode?: number | null;
    pid?: number;
    logFile: string;
}

interface RunLogEntry {
    time: string;
    stream: "stdout" | "stderr" | "system" | string;
    text: string;
}

interface StudioConfig {
    version?: 1;
    project?: {
        name?: string;
        rootStrategy?: "git";
    };
    commands?: WorktreeAction[];
    pipelines?: unknown[];
    security?: {
        allowArbitraryShell?: boolean;
    };
    [key: string]: unknown;
}

interface ConfigEnvelope {
    config: StudioConfig;
    exists?: boolean;
    revision?: string;
}

interface ConfirmRun {
    worktree: WorktreeInfo;
    action: WorktreeAction;
}

type ConnectionState = "loading" | "connected" | "offline";
type EventState = "connecting" | "connected" | "retrying" | "offline";

const fallbackConfig: StudioConfig = {
    version: 1,
    project: { name: "Worktree Studio", rootStrategy: "git" },
    commands: [
        {
            id: "build",
            label: "Build",
            type: "build",
            mode: "one-shot",
            cwd: ".",
            packageScript: "build",
            visible: true,
        },
        {
            id: "test",
            label: "Test",
            type: "test",
            mode: "one-shot",
            cwd: ".",
            packageScript: "test",
            visible: true,
        },
        {
            id: "lint.types",
            label: "Type lint",
            type: "lint",
            mode: "one-shot",
            cwd: ".",
            packageScript: "lint:types",
            visible: true,
        },
    ],
};

const fallbackWorktrees: WorktreeInfo[] = [
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
        path: "/workspace/feature-actions",
        branch: "feature/actions",
        dirty: true,
        ahead: 2,
        behind: 0,
        status: "dirty",
        lastRun: "test running",
    },
    {
        path: "/workspace/release",
        branch: "release/next",
        dirty: false,
        ahead: 1,
        behind: 3,
        status: "failed",
        lastRun: "lint failed",
    },
];

const fallbackRuns: RunInfo[] = [
    {
        id: "run-1024",
        commandId: "test",
        commandLabel: "Test",
        worktreePath: "/workspace/feature-actions",
        status: "running",
        startedAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
        logFile: "logs/run-1024.log",
    },
    {
        id: "run-1023",
        commandId: "build",
        commandLabel: "Build",
        worktreePath: "/workspace/main",
        status: "succeeded",
        startedAt: new Date(Date.now() - 1000 * 60 * 19).toISOString(),
        endedAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
        logFile: "logs/run-1023.log",
    },
    {
        id: "run-1022",
        commandId: "lint.types",
        commandLabel: "Type lint",
        worktreePath: "/workspace/release",
        status: "failed",
        startedAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
        endedAt: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
        exitCode: 2,
        logFile: "logs/run-1022.log",
    },
];

const fallbackLogs: RunLogEntry[] = [
    { time: new Date().toISOString(), stream: "system", text: "$ pnpm run test\n" },
    { time: new Date().toISOString(), stream: "stdout", text: "waiting for backend events...\n" },
];

const commandTypes: CommandType[] = ["dev", "build", "preview", "test", "lint", "pipeline", "custom"];
const commandModes: CommandMode[] = ["one-shot", "long-running"];

export function App() {
    const token = useMemo(() => {
        const params = new URLSearchParams(window.location.search);
        const nextToken = params.get("token") || window.localStorage.getItem("wts-token") || "";
        if (nextToken) window.localStorage.setItem("wts-token", nextToken);
        return nextToken;
    }, []);

    const [configEnvelope, setConfigEnvelope] = useState<ConfigEnvelope>({ config: fallbackConfig, exists: false });
    const [configuredActions, setConfiguredActions] = useState<WorktreeAction[]>(normalizeActions(fallbackConfig.commands));
    const [discoveredActions, setDiscoveredActions] = useState<WorktreeAction[]>([]);
    const [worktrees, setWorktrees] = useState<WorktreeInfo[]>(fallbackWorktrees);
    const [runs, setRuns] = useState<RunInfo[]>(fallbackRuns);
    const [logsByRun, setLogsByRun] = useState<Record<string, RunLogEntry[]>>({ "run-1024": fallbackLogs });
    const [connection, setConnection] = useState<ConnectionState>("loading");
    const [events, setEvents] = useState<EventState>("connecting");
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [activeWorktree, setActiveWorktree] = useState<WorktreeInfo | null>(null);
    const [selectedRunId, setSelectedRunId] = useState<string>("");
    const [selectedActionByWorktree, setSelectedActionByWorktree] = useState<Record<string, string>>({});
    const [drafts, setDrafts] = useState<WorktreeAction[]>(normalizeActions(fallbackConfig.commands));
    const [selectedDraftId, setSelectedDraftId] = useState<string>(fallbackConfig.commands?.[0]?.id ?? "");
    const [savingSettings, setSavingSettings] = useState(false);
    const [running, setRunning] = useState<Record<string, boolean>>({});
    const [stopping, setStopping] = useState<Record<string, boolean>>({});
    const [confirmRun, setConfirmRun] = useState<ConfirmRun | null>(null);
    const [confirmDeleteWorktree, setConfirmDeleteWorktree] = useState<WorktreeInfo | null>(null);
    const [deletingWorktree, setDeletingWorktree] = useState<Record<string, boolean>>({});

    const projectName = configEnvelope.config.project?.name || "Worktree Studio";
    const runnableActions = useMemo(() => configuredActions.filter((action) => action.visible !== false), [configuredActions]);
    const filteredWorktrees = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return worktrees;
        return worktrees.filter((worktree) =>
            [worktree.path, worktree.branch, worktreeStatus(worktree), worktree.statusLine]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(needle)),
        );
    }, [query, worktrees]);
    const activeRuns = activeWorktree ? runsForWorktree(runs, activeWorktree.path) : [];
    const selectedRun = activeRuns.find((run) => run.id === selectedRunId) || activeRuns[0];
    const selectedLogs = selectedRun ? logsByRun[selectedRun.id] || [] : [];
    const selectedDraft = drafts.find((action) => action.id === selectedDraftId) || drafts[0] || null;
    const api = useCallback(
        async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
            const headers = new Headers(options.headers);
            if (token) headers.set("x-wts-token", token);
            if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
            const url = token ? `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : path;
            const response = await fetch(url, { ...options, headers });
            if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
            if (response.status === 204) return null as T;
            const text = await response.text();
            if (!text) return null as T;
            return JSON.parse(text) as T;
        },
        [token],
    );

    const refresh = useCallback(async () => {
        setLoading(true);
        setConnection("loading");
        let online = false;

        try {
            const payload = await api<ConfigEnvelope | StudioConfig>("/api/config");
            const envelope = isConfigEnvelope(payload) ? payload : { config: payload, exists: true };
            setConfigEnvelope(envelope);
            const nextActions = normalizeActions(envelope.config.commands);
            setConfiguredActions(nextActions);
            setDrafts(nextActions);
            setSelectedDraftId((current) => current || nextActions[0]?.id || "");
            online = true;
        } catch {
            const nextActions = normalizeActions(fallbackConfig.commands);
            setConfigEnvelope({ config: fallbackConfig, exists: false });
            setConfiguredActions(nextActions);
            setDrafts(nextActions);
            setSelectedDraftId((current) => current || nextActions[0]?.id || "");
        }

        try {
            const payload = await api<{ discovered?: unknown[]; commands?: unknown[] }>("/api/discovery/scripts");
            setDiscoveredActions(normalizeActions(payload.discovered || payload.commands));
            online = true;
        } catch {
            setDiscoveredActions([]);
        }

        try {
            const payload = await api<{ worktrees?: unknown[]; items?: unknown[] } | unknown[]>("/api/worktrees");
            const nextWorktrees = normalizeWorktrees(
                Array.isArray(payload) ? payload : payload.worktrees || payload.items || [],
            );
            setWorktrees(nextWorktrees);
            online = true;
        } catch {
            setWorktrees(fallbackWorktrees);
        }

        try {
            const payload = await api<{ runs?: unknown[]; items?: unknown[] } | unknown[]>("/api/runs");
            const nextRuns = normalizeRuns(Array.isArray(payload) ? payload : payload.runs || payload.items || []);
            setRuns(nextRuns);
            online = true;
        } catch {
            setRuns(fallbackRuns);
        }

        setConnection(online ? "connected" : "offline");
        setLoading(false);
    }, [api]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        const url = token ? `/api/events?token=${encodeURIComponent(token)}` : "/api/events";
        const eventSource = new EventSource(url);
        setEvents("connecting");
        eventSource.addEventListener("hello", () => setEvents("connected"));
        eventSource.addEventListener("run", (event) => {
            setEvents("connected");
            const run = normalizeRun(parseEventData(event.data), 0);
            setRuns((current) => upsertRun(current, run));
        });
        eventSource.addEventListener("log", (event) => {
            setEvents("connected");
            const payload = parseEventData(event.data) as { run?: unknown; entry?: unknown };
            const run = payload.run ? normalizeRun(payload.run, 0) : null;
            const entry = normalizeLogEntry(payload.entry);
            if (!run || !entry) return;
            setRuns((current) => upsertRun(current, run));
            setLogsByRun((current) => ({
                ...current,
                [run.id]: [...(current[run.id] || []), entry].slice(-500),
            }));
        });
        eventSource.onerror = () => setEvents("retrying");
        return () => eventSource.close();
    }, [token]);

    useEffect(() => {
        if (!activeWorktree) return;
        const nextRuns = runsForWorktree(runs, activeWorktree.path);
        setSelectedRunId((current) => current || nextRuns[0]?.id || "");
    }, [activeWorktree, runs]);

    async function runAction(worktree: WorktreeInfo, action: WorktreeAction) {
        if (action.confirm) {
            setConfirmRun({ worktree, action });
            return;
        }
        await executeRun(worktree, action);
    }

    async function executeRun(worktree: WorktreeInfo, action: WorktreeAction) {
        const key = `${worktree.path}:${action.id}`;
        setRunning((current) => ({ ...current, [key]: true }));
        try {
            const payload = await api<{ run?: unknown }>("/api/runs", {
                method: "POST",
                body: JSON.stringify({ worktree: worktree.path, commandId: action.id }),
            });
            if (payload.run) {
                const run = normalizeRun(payload.run, 0);
                setRuns((current) => upsertRun(current, run));
                setSelectedRunId(run.id);
            }
            toast.success(`Action started: ${action.label || action.id}`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not start action");
        } finally {
            setRunning((current) => ({ ...current, [key]: false }));
        }
    }

    async function loadRunLogs(run: RunInfo) {
        try {
            const payload = await api<{ logs?: unknown[] }>(`/api/runs/${encodeURIComponent(run.id)}/logs`);
            setLogsByRun((current) => ({
                ...current,
                [run.id]: normalizeLogs(payload.logs || []),
            }));
        } catch (error) {
            setLogsByRun((current) => ({
                ...current,
                [run.id]: [
                    {
                        time: new Date().toISOString(),
                        stream: "system",
                        text: error instanceof Error ? error.message : "Could not load logs",
                    },
                ],
            }));
        }
    }

    async function stopRun(run: RunInfo) {
        setStopping((current) => ({ ...current, [run.id]: true }));
        try {
            const response = await api<{ stopped?: boolean }>(`/api/runs/${encodeURIComponent(run.id)}`, {
                method: "DELETE",
            });
            if (!response.stopped) {
                toast.error("Run is not active");
                return;
            }
            setRuns((current) => markRunStatus(current, run.id, "cancelled"));
            toast.success("Run aborted");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not abort run");
        } finally {
            setStopping((current) => ({ ...current, [run.id]: false }));
        }
    }

    async function deleteWorktree(worktree: WorktreeInfo) {
        setDeletingWorktree((current) => ({ ...current, [worktree.path]: true }));
        try {
            const payload = await api<{ removed?: WorktreeInfo; worktrees?: unknown[] }>("/api/worktrees", {
                method: "DELETE",
                body: JSON.stringify({ worktree: worktree.path }),
            });
            const nextWorktrees = payload.worktrees ? normalizeWorktrees(payload.worktrees) : null;
            setWorktrees((current) => nextWorktrees ?? current.filter((item) => item.path !== worktree.path));
            setRuns((current) => current.filter((run) => run.worktreePath !== worktree.path));
            setSelectedActionByWorktree((current) => {
                const next = { ...current };
                delete next[worktree.path];
                return next;
            });
            setActiveWorktree((current) => (current?.path === worktree.path ? null : current));
            toast.success(`Worktree removed: ${worktree.branch || basename(worktree.path)}`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not remove worktree");
        } finally {
            setDeletingWorktree((current) => ({ ...current, [worktree.path]: false }));
        }
    }

    function updateDraft(patch: Partial<WorktreeAction>) {
        if (!selectedDraft) return;
        setDrafts((current) =>
            current.map((action) => (action.id === selectedDraft.id ? normalizeAction({ ...action, ...patch }, 0) : action)),
        );
        if (patch.id) setSelectedDraftId(patch.id);
    }

    function createAction() {
        const nextAction = createBlankAction(uniqueActionId(drafts));
        setDrafts((current) => [...current, nextAction]);
        setSelectedDraftId(nextAction.id);
    }

    function deleteAction() {
        if (!selectedDraft) return;
        const targetId = selectedDraft.id;
        const targetIndex = drafts.findIndex((action) => action.id === targetId);
        const next = drafts.filter((action) => action.id !== targetId);
        setDrafts(next);
        setSelectedDraftId(next[Math.min(Math.max(targetIndex, 0), next.length - 1)]?.id || "");
        toast.success("Action removed. Save actions to persist.");
    }

    function importDiscoveredAction(action: WorktreeAction) {
        const normalized = normalizeAction({ ...action, discovered: false }, drafts.length);
        setDrafts((current) => {
            const exists = current.some((item) => item.id === normalized.id);
            return exists ? current.map((item) => (item.id === normalized.id ? normalized : item)) : [...current, normalized];
        });
        setSelectedDraftId(normalized.id);
        toast.success(`Imported action: ${normalized.label}`);
    }

    async function saveSettings() {
        const validation = validateActions(drafts);
        if (validation) {
            toast.error(validation);
            return;
        }

        setSavingSettings(true);
        try {
            const nextConfig: StudioConfig = {
                ...configEnvelope.config,
                version: 1,
                commands: drafts.map(toConfigAction),
            };
            const body = configEnvelope.revision ? { config: nextConfig, revision: configEnvelope.revision } : nextConfig;
            const response = await api<ConfigEnvelope | StudioConfig>("/api/config", {
                method: "PUT",
                body: JSON.stringify(body),
            });
            const nextEnvelope = isConfigEnvelope(response) ? response : { config: response, exists: true };
            const nextActions = normalizeActions(nextEnvelope.config.commands);
            setConfigEnvelope(nextEnvelope);
            setConfiguredActions(nextActions);
            setDrafts(nextActions);
            setSelectedDraftId(nextActions[0]?.id || "");
            setSettingsOpen(false);
            toast.success("Actions saved");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not save actions");
        } finally {
            setSavingSettings(false);
        }
    }

    return (
        <div className="min-h-screen bg-background">
            <Toaster />
            <main className="mx-auto flex w-full max-w-[1760px] flex-col gap-6 p-4 md:p-6">
                <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
                    <div className="flex min-w-0 flex-col gap-2">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <FolderGit2Icon data-icon="inline-start" />
                            <span>Worktree Studio</span>
                        </div>
                        <div className="flex flex-col gap-2">
                            <h1 className="truncate text-3xl font-semibold tracking-normal md:text-4xl">{projectName}</h1>
                        </div>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                        <Input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Filter worktrees"
                            className="sm:w-72"
                        />
                        <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
                            {loading ? <Loader2Icon data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
                            Refresh
                        </Button>
                        <Button onClick={() => setSettingsOpen(true)}>
                            <Settings2Icon data-icon="inline-start" />
                            Settings
                        </Button>
                    </div>
                </header>

                {loading ? (
                    <WorktreeGridSkeleton />
                ) : filteredWorktrees.length ? (
                    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                        {filteredWorktrees.map((worktree) => {
                            const worktreeRuns = runsForWorktree(runs, worktree.path);
                            const activeRun = worktreeRuns.find(canStopRun);
                            return (
                                <WorktreeCard
                                    key={worktree.path}
                                    worktree={worktree}
                                    actions={runnableActions}
                                    selectedActionId={selectedActionByWorktree[worktree.path] || runnableActions[0]?.id || ""}
                                    isRunning={Boolean(
                                        running[
                                            `${worktree.path}:${
                                                selectedActionByWorktree[worktree.path] || runnableActions[0]?.id || ""
                                            }`
                                        ],
                                    )}
                                    runs={worktreeRuns}
                                    activeRun={activeRun}
                                    isStoppingRun={Boolean(activeRun && stopping[activeRun.id])}
                                    isDeleting={Boolean(deletingWorktree[worktree.path])}
                                    onSelectAction={(actionId) =>
                                        setSelectedActionByWorktree((current) => ({ ...current, [worktree.path]: actionId }))
                                    }
                                    onRun={(action) => void runAction(worktree, action)}
                                    onStopRun={(run) => void stopRun(run)}
                                    onDelete={() => setConfirmDeleteWorktree(worktree)}
                                    onOpen={() => {
                                        setActiveWorktree(worktree);
                                        setSelectedRunId(worktreeRuns[0]?.id || "");
                                    }}
                                    onOpenSettings={() => setSettingsOpen(true)}
                                />
                            );
                        })}
                    </section>
                ) : (
                    <Empty className="min-h-[360px] border">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <FolderGit2Icon />
                            </EmptyMedia>
                            <EmptyTitle>No worktrees match</EmptyTitle>
                            <EmptyDescription>Adjust the filter or refresh the repository state.</EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button variant="outline" onClick={() => setQuery("")}>
                                Clear filter
                            </Button>
                        </EmptyContent>
                    </Empty>
                )}
            </main>

            <Sheet open={Boolean(activeWorktree)} onOpenChange={(open) => !open && setActiveWorktree(null)}>
                <SheetContent className="overflow-hidden p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
                    <SheetHeader className="min-w-0 shrink-0 border-b">
                        <SheetTitle className="truncate">
                            {activeWorktree?.branch || basename(activeWorktree?.path || "Worktree")}
                        </SheetTitle>
                        <SheetDescription className="break-all">{activeWorktree?.path}</SheetDescription>
                    </SheetHeader>
                    <Tabs defaultValue="runs" className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden">
                        <div className="shrink-0 border-b px-4 py-3">
                            <TabsList>
                                <TabsTrigger value="runs">
                                    <HistoryIcon data-icon="inline-start" />
                                    Runs
                                </TabsTrigger>
                                <TabsTrigger value="details">
                                    <TerminalSquareIcon data-icon="inline-start" />
                                    Details
                                </TabsTrigger>
                            </TabsList>
                        </div>
                        <TabsContent value="runs" className="min-h-0 flex-1 overflow-hidden p-0">
                            <div className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,220px)_minmax(0,1fr)] md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-1">
                                <ScrollArea className="h-full min-h-0 min-w-0 border-b md:border-r md:border-b-0">
                                    <div className="flex flex-col gap-2 p-4">
                                        {activeRuns.length ? (
                                            activeRuns.map((run) => (
                                                <Button
                                                    key={run.id}
                                                    variant={run.id === selectedRun?.id ? "secondary" : "ghost"}
                                                    className="h-auto justify-start px-3 py-2"
                                                    onClick={() => {
                                                        setSelectedRunId(run.id);
                                                        void loadRunLogs(run);
                                                    }}
                                                >
                                                    <div className="flex min-w-0 flex-col items-start gap-1">
                                                        <span className="truncate font-medium">
                                                            {run.commandLabel || run.commandId || run.id}
                                                        </span>
                                                        <span className="text-xs text-muted-foreground">
                                                            {formatTime(run.startedAt)} · {run.status}
                                                        </span>
                                                    </div>
                                                </Button>
                                            ))
                                        ) : (
                                            <Empty className="border">
                                                <EmptyHeader>
                                                    <EmptyTitle>No runs</EmptyTitle>
                                                    <EmptyDescription>Run an action from this worktree card.</EmptyDescription>
                                                </EmptyHeader>
                                            </Empty>
                                        )}
                                    </div>
                                </ScrollArea>
                                <ScrollArea className="h-full min-h-0 min-w-0">
                                    <div className="flex min-w-0 flex-col gap-3 p-4">
                                        {selectedRun && (
                                            <div className="flex flex-wrap items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <h2 className="truncate text-base font-medium">
                                                        {selectedRun.commandLabel || selectedRun.id}
                                                    </h2>
                                                    <p className="break-all text-sm text-muted-foreground">{selectedRun.logFile}</p>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-2">
                                                    <StatusBadge status={selectedRun.status} />
                                                    {canStopRun(selectedRun) && (
                                                        <Button
                                                            variant="destructive"
                                                            size="sm"
                                                            disabled={Boolean(stopping[selectedRun.id])}
                                                            onClick={() => void stopRun(selectedRun)}
                                                        >
                                                            {stopping[selectedRun.id] ? (
                                                                <Loader2Icon data-icon="inline-start" />
                                                            ) : (
                                                                <XCircleIcon data-icon="inline-start" />
                                                            )}
                                                            Abort
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        <pre className="min-h-[360px] min-w-0 max-w-full overflow-auto rounded-lg border bg-muted/35 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words [word-break:normal]">
                                            {selectedLogs.length
                                                ? selectedLogs.map(formatLogEntry).join("")
                                                : "No logs loaded. Select a run to fetch logs."}
                                        </pre>
                                    </div>
                                </ScrollArea>
                            </div>
                        </TabsContent>
                        <TabsContent value="details" className="min-h-0 flex-1 overflow-hidden p-0">
                            <ScrollArea className="h-full min-h-0">
                                <div className="p-4 pb-8">
                                    {activeWorktree && <WorktreeDetails worktree={activeWorktree} />}
                                </div>
                            </ScrollArea>
                        </TabsContent>
                    </Tabs>
                </SheetContent>
            </Sheet>

            <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
                <SheetContent className="overflow-hidden p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-4xl">
                    <SheetHeader className="shrink-0 border-b">
                        <SheetTitle>Actions settings</SheetTitle>
                        <SheetDescription>Actions are saved to config.commands and launched with /api/runs.</SheetDescription>
                    </SheetHeader>
                    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[260px_minmax(0,1fr)] md:grid-rows-1">
                        <ScrollArea className="max-h-72 min-h-0 border-b md:h-full md:max-h-none md:border-r md:border-b-0">
                            <div className="flex flex-col gap-3 p-4">
                                <Button variant="outline" onClick={createAction}>
                                    <PlusIcon data-icon="inline-start" />
                                    New action
                                </Button>
                                <Separator />
                                <div className="flex flex-col gap-2">
                                    {drafts.length ? (
                                        drafts.map((action) => (
                                            <Button
                                                key={action.id}
                                                variant={action.id === selectedDraft?.id ? "secondary" : "ghost"}
                                                className="h-auto justify-start px-3 py-2"
                                                onClick={() => setSelectedDraftId(action.id)}
                                            >
                                                <div className="flex min-w-0 flex-col items-start gap-1">
                                                    <span className="truncate font-medium">{action.label || action.id}</span>
                                                    <span className="truncate text-xs text-muted-foreground">
                                                        {action.id} · {action.type || "custom"}
                                                    </span>
                                                </div>
                                            </Button>
                                        ))
                                    ) : (
                                        <Empty className="border">
                                            <EmptyHeader>
                                                <EmptyTitle>No actions</EmptyTitle>
                                                <EmptyDescription>Create the first configured action.</EmptyDescription>
                                            </EmptyHeader>
                                        </Empty>
                                    )}
                                </div>
                                {discoveredActions.length > 0 && (
                                    <>
                                        <Separator />
                                        <div className="flex flex-col gap-2">
                                            <p className="text-sm font-medium">Discovered</p>
                                            {discoveredActions.slice(0, 8).map((action) => (
                                                <Button
                                                    key={action.id}
                                                    variant="ghost"
                                                    className="h-auto justify-start px-3 py-2"
                                                    onClick={() => importDiscoveredAction(action)}
                                                >
                                                    <div className="flex min-w-0 flex-col items-start gap-1">
                                                        <span className="truncate font-medium">{action.label || action.id}</span>
                                                        <span className="truncate text-xs text-muted-foreground">
                                                            {commandLine(action)}
                                                        </span>
                                                    </div>
                                                </Button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </ScrollArea>
                        <ScrollArea className="h-full min-h-0">
                            <div className="p-4">
                                {selectedDraft ? (
                                    <ActionEditor action={selectedDraft} onChange={updateDraft} onDelete={deleteAction} />
                                ) : (
                                    <Empty className="min-h-[320px] border">
                                        <EmptyHeader>
                                            <EmptyTitle>No action selected</EmptyTitle>
                                            <EmptyDescription>Create or import an action to edit it.</EmptyDescription>
                                        </EmptyHeader>
                                        <EmptyContent>
                                            <Button variant="outline" onClick={createAction}>
                                                <PlusIcon data-icon="inline-start" />
                                                New action
                                            </Button>
                                        </EmptyContent>
                                    </Empty>
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                    <SheetFooter className="shrink-0 border-t">
                        <Button variant="outline" onClick={() => setSettingsOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={() => void saveSettings()} disabled={savingSettings}>
                            {savingSettings ? <Loader2Icon data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
                            Save actions
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>

            <AlertDialog open={Boolean(confirmRun)} onOpenChange={(open) => !open && setConfirmRun(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Run action?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmRun
                                ? `${confirmRun.action.label || confirmRun.action.id} will run on ${
                                      confirmRun.worktree.branch || confirmRun.worktree.path
                                  }.`
                                : ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (confirmRun) void executeRun(confirmRun.worktree, confirmRun.action);
                                setConfirmRun(null);
                            }}
                        >
                            Run
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={Boolean(confirmDeleteWorktree)}
                onOpenChange={(open) => !open && setConfirmDeleteWorktree(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove worktree?</AlertDialogTitle>
                        <AlertDialogDescription className="break-words [word-break:break-word]">
                            {confirmDeleteWorktree
                                ? `This removes ${confirmDeleteWorktree.path} from disk. The branch is not deleted.`
                                : ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            onClick={() => {
                                if (confirmDeleteWorktree) void deleteWorktree(confirmDeleteWorktree);
                                setConfirmDeleteWorktree(null);
                            }}
                        >
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function WorktreeCard({
    worktree,
    actions,
    selectedActionId,
    isRunning,
    runs,
    activeRun,
    isStoppingRun,
    isDeleting,
    onSelectAction,
    onRun,
    onStopRun,
    onDelete,
    onOpen,
    onOpenSettings,
}: {
    worktree: WorktreeInfo;
    actions: WorktreeAction[];
    selectedActionId: string;
    isRunning: boolean;
    runs: RunInfo[];
    activeRun?: RunInfo;
    isStoppingRun: boolean;
    isDeleting: boolean;
    onSelectAction: (actionId: string) => void;
    onRun: (action: WorktreeAction) => void;
    onStopRun: (run: RunInfo) => void;
    onDelete: () => void;
    onOpen: () => void;
    onOpenSettings: () => void;
}) {
    const selectedAction = actions.find((action) => action.id === selectedActionId) || actions[0];
    const latestRun = runs[0];
    const deleteDisabled = worktree.removable === false || Boolean(activeRun) || isDeleting;
    const deleteTitle =
        worktree.removable === false
            ? "This worktree cannot be removed"
            : activeRun
              ? "Stop the active run before removing"
              : "Remove worktree";

    return (
        <Card
            className="flex min-h-[240px] cursor-pointer flex-col transition hover:ring-foreground/25 focus-visible:ring-3 focus-visible:ring-ring/50"
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen();
                }
            }}
        >
            <CardHeader className="gap-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <CardTitle className="truncate text-base">{worktree.branch || "detached"}</CardTitle>
                        <CardDescription className="truncate">{worktree.path}</CardDescription>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <ActionStatusIcon run={latestRun} />
                        <Button
                            title={deleteTitle}
                            variant="ghost"
                            size="icon-sm"
                            className={cn("text-destructive", deleteDisabled && "opacity-50")}
                            aria-disabled={deleteDisabled}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (deleteDisabled) return;
                                onDelete();
                            }}
                        >
                            {isDeleting ? <Loader2Icon /> : <Trash2Icon />}
                            <span className="sr-only">Remove worktree</span>
                        </Button>
                        {activeRun && (
                            <Button
                                title="Abort"
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive"
                                disabled={isStoppingRun}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onStopRun(activeRun);
                                }}
                            >
                                {isStoppingRun ? <Loader2Icon /> : <XCircleIcon />}
                                <span className="sr-only">Abort</span>
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
                {actions.length ? (
                    <FieldGroup onClick={(event) => event.stopPropagation()}>
                        <Field>
                            <FieldLabel>Action</FieldLabel>
                            <Select value={selectedAction?.id || ""} onValueChange={onSelectAction}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select action" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {actions.map((action) => (
                                            <SelectItem key={action.id} value={action.id}>
                                                {action.label || action.id}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            <FieldDescription>{selectedAction ? commandLine(selectedAction) : "No action selected"}</FieldDescription>
                        </Field>
                    </FieldGroup>
                ) : (
                    <Empty className="border" onClick={(event) => event.stopPropagation()}>
                        <EmptyHeader>
                            <EmptyTitle>No actions configured</EmptyTitle>
                            <EmptyDescription>Add an action in settings before running this worktree.</EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button variant="outline" onClick={onOpenSettings}>
                                <Settings2Icon data-icon="inline-start" />
                                Settings
                            </Button>
                        </EmptyContent>
                    </Empty>
                )}
            </CardContent>
            <CardFooter onClick={(event) => event.stopPropagation()}>
                <Button className="w-full" disabled={!selectedAction || isRunning} onClick={() => selectedAction && onRun(selectedAction)}>
                    {isRunning ? <Loader2Icon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
                    Run
                </Button>
            </CardFooter>
        </Card>
    );
}

function ActionStatusIcon({ run }: { run?: RunInfo }) {
    if (!run) return null;
    const status = normalizeStatus(run.status);
    if (status === "running" || status === "queued") {
        return (
            <span title={statusLabel(status)} className="text-muted-foreground">
                <Loader2Icon className="animate-spin" />
                <span className="sr-only">{statusLabel(status)}</span>
            </span>
        );
    }
    if (status === "failed") {
        return (
            <span title={statusLabel(status)} className="text-destructive">
                <XCircleIcon />
                <span className="sr-only">{statusLabel(status)}</span>
            </span>
        );
    }
    if (status === "succeeded") {
        return (
            <span title={statusLabel(status)} className="text-muted-foreground">
                <CheckCircle2Icon />
                <span className="sr-only">{statusLabel(status)}</span>
            </span>
        );
    }
    return null;
}

function ActionEditor({
    action,
    onChange,
    onDelete,
}: {
    action: WorktreeAction;
    onChange: (patch: Partial<WorktreeAction>) => void;
    onDelete: () => void;
}) {
    return (
        <FieldGroup>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="truncate text-lg font-medium">{action.label || "New action"}</h2>
                    <p className="truncate text-sm text-muted-foreground">{action.id || "unsaved"}</p>
                </div>
                <Button variant="destructive" onClick={onDelete} disabled={!action.id}>
                    <Trash2Icon data-icon="inline-start" />
                    Delete
                </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
                <Field>
                    <FieldLabel htmlFor="action-id">ID</FieldLabel>
                    <Input id="action-id" value={action.id} onChange={(event) => onChange({ id: event.target.value })} />
                </Field>
                <Field>
                    <FieldLabel htmlFor="action-label">Label</FieldLabel>
                    <Input id="action-label" value={action.label} onChange={(event) => onChange({ label: event.target.value })} />
                </Field>
                <Field>
                    <FieldLabel>Type</FieldLabel>
                    <Select value={String(action.type || "custom")} onValueChange={(type) => onChange({ type })}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {commandTypes.map((type) => (
                                    <SelectItem key={type} value={type}>
                                        {type}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>
                <Field>
                    <FieldLabel>Mode</FieldLabel>
                    <Select value={String(action.mode || "one-shot")} onValueChange={(mode) => onChange({ mode })}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {commandModes.map((mode) => (
                                    <SelectItem key={mode} value={mode}>
                                        {mode}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>
                <Field>
                    <FieldLabel htmlFor="action-cwd">CWD</FieldLabel>
                    <Input id="action-cwd" value={action.cwd || "."} onChange={(event) => onChange({ cwd: event.target.value })} />
                </Field>
                <Field>
                    <FieldLabel htmlFor="action-package-script">Package script</FieldLabel>
                    <Input
                        id="action-package-script"
                        value={action.packageScript || ""}
                        onChange={(event) => onChange({ packageScript: event.target.value })}
                        placeholder="build"
                    />
                </Field>
            </div>
            <Field>
                <FieldLabel htmlFor="action-command">Shell command</FieldLabel>
                <Textarea
                    id="action-command"
                    value={action.command || action.shell || ""}
                    onChange={(event) => onChange({ command: event.target.value, shell: undefined })}
                    placeholder="pnpm run build"
                    rows={4}
                />
                <FieldDescription>Shell commands require security.allowArbitraryShell in the project config.</FieldDescription>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
                <Field orientation="horizontal">
                    <Switch checked={action.visible !== false} onCheckedChange={(visible) => onChange({ visible })} />
                    <div className="flex flex-col gap-1">
                        <FieldLabel>Visible</FieldLabel>
                        <FieldDescription>Show this action in worktree cards.</FieldDescription>
                    </div>
                </Field>
                <Field orientation="horizontal">
                    <Switch checked={Boolean(action.confirm)} onCheckedChange={(confirm) => onChange({ confirm })} />
                    <div className="flex flex-col gap-1">
                        <FieldLabel>Confirm before run</FieldLabel>
                        <FieldDescription>Require an extra confirmation dialog.</FieldDescription>
                    </div>
                </Field>
            </div>
        </FieldGroup>
    );
}

function WorktreeDetails({ worktree }: { worktree: WorktreeInfo }) {
    const rows = [
        ["Path", worktree.path],
        ["Branch", worktree.branch || "detached"],
        ["Status", worktreeStatus(worktree)],
        ["Ahead / behind", `${worktree.ahead || 0} / ${worktree.behind || 0}`],
        ["Dirty", worktree.dirty ? "yes" : "no"],
        ["Locked", worktree.locked || "no"],
        ["Reason", worktree.reason || "none"],
    ];

    return (
        <div className="grid gap-3">
            {rows.map(([label, value]) => (
                <div key={label} className="grid gap-1 rounded-lg border p-3">
                    <span className="text-xs font-medium text-muted-foreground">{label}</span>
                    <strong className="break-all text-sm font-medium">{value}</strong>
                </div>
            ))}
        </div>
    );
}

function WorktreeGridSkeleton() {
    return (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
                <Card key={index} className="min-h-[300px]">
                    <CardHeader>
                        <Skeleton className="h-5 w-3/4" />
                        <Skeleton className="h-4 w-full" />
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-24 w-full" />
                    </CardContent>
                    <CardFooter className="grid grid-cols-2 gap-2">
                        <Skeleton className="h-8" />
                        <Skeleton className="h-8" />
                    </CardFooter>
                </Card>
            ))}
        </section>
    );
}

function StatusBadge({ status }: { status: RunStatus }) {
    const normalized = normalizeStatus(status);
    const icon = statusIcon(normalized);
    return (
        <Badge variant={statusVariant(normalized)} className="gap-1">
            {icon}
            {statusLabel(normalized)}
        </Badge>
    );
}

function statusIcon(status: string) {
    if (status === "succeeded" || status === "ready") return <CheckCircle2Icon />;
    if (status === "failed" || status === "dirty") return <XCircleIcon />;
    if (status === "running" || status === "queued") return <Loader2Icon className="animate-spin" />;
    if (status === "cancelled" || status === "prunable") return <AlertCircleIcon />;
    return <CircleIcon />;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
    if (status === "failed" || status === "dirty") return "destructive";
    if (status === "succeeded" || status === "ready") return "secondary";
    return "outline";
}

function statusLabel(status: unknown) {
    const normalized = normalizeStatus(status);
    if (normalized === "running") return "запущен";
    if (normalized === "failed") return "упал";
    if (normalized === "succeeded") return "успешно";
    if (normalized === "queued") return "в очереди";
    if (normalized === "cancelled") return "отменён";
    if (normalized === "ready") return "готов";
    return String(status || "нет статуса");
}

function runsForWorktree(runs: RunInfo[], path: string) {
    return runs
        .filter((run) => run.worktreePath === path)
        .sort((left, right) => String(right.startedAt || right.id).localeCompare(String(left.startedAt || left.id)));
}

function canStopRun(run: RunInfo) {
    return ["queued", "running"].includes(normalizeStatus(run.status));
}

function markRunStatus(runs: RunInfo[], runId: string, status: RunStatus) {
    return runs.map((run) =>
        run.id === runId
            ? {
                  ...run,
                  status,
                  endedAt: status === "cancelled" ? new Date().toISOString() : run.endedAt,
              }
            : run,
    );
}

function worktreeStatus(worktree: WorktreeInfo) {
    if (worktree.prunable) return "prunable";
    if (worktree.dirty) return "dirty";
    return normalizeStatus(worktree.status || "ready");
}

function normalizeStatus(status: unknown) {
    const value = String(status || "").toLowerCase();
    if (["success", "passed", "pass", "ok", "clean"].includes(value)) return "succeeded";
    if (["ready", "idle"].includes(value)) return "ready";
    if (["fail", "failed", "error"].includes(value)) return "failed";
    if (["queued", "pending"].includes(value)) return "queued";
    return value || "ready";
}

function normalizeActions(items: unknown): WorktreeAction[] {
    if (!Array.isArray(items)) return [];
    return items.map(normalizeAction);
}

function normalizeAction(item: unknown, index: number): WorktreeAction {
    if (typeof item === "string") {
        return {
            id: slug(item) || `action-${index + 1}`,
            label: item,
            type: "custom",
            mode: "one-shot",
            cwd: ".",
            command: item,
            visible: true,
        };
    }
    const source = isRecord(item) ? item : {};
    const id = String(source.id || source.name || source.label || source.packageScript || source.command || `action-${index + 1}`);
    return {
        id,
        label: String(source.label || source.name || id),
        type: String(source.type || "custom"),
        kind: source.kind ? String(source.kind) : undefined,
        mode: String(source.mode || "one-shot"),
        cwd: String(source.cwd || "."),
        command: source.command ? String(source.command) : undefined,
        shell: source.shell ? String(source.shell) : undefined,
        packageScript: source.packageScript || source.script ? String(source.packageScript || source.script) : undefined,
        visible: source.visible !== false,
        confirm: source.confirm === true,
        discovered: source.discovered === true,
    };
}

function normalizeWorktrees(items: unknown[]): WorktreeInfo[] {
    return items.map((item) => {
        const source = isRecord(item) ? item : {};
        return {
            path: String(source.path || source.cwd || source.id || ""),
            branch: String(source.branch || source.ref || source.name || "detached"),
            dirty: Boolean(source.dirty || source.dirtyFiles || source.changes),
            ahead: Number(source.ahead || 0),
            behind: Number(source.behind || 0),
            prunable: Boolean(source.prunable),
            detached: Boolean(source.detached),
            locked: source.locked ? String(source.locked) : undefined,
            reason: source.reason ? String(source.reason) : undefined,
            status: String(source.status || (source.dirty ? "dirty" : "ready")),
            statusLine: source.statusLine ? String(source.statusLine) : undefined,
            lastRun: source.lastRun || source.last_run ? String(source.lastRun || source.last_run) : undefined,
            removable: source.removable === true,
        };
    });
}

function normalizeRuns(items: unknown[]): RunInfo[] {
    return items.map(normalizeRun);
}

function normalizeRun(item: unknown, index: number): RunInfo {
    const source = isRecord(item) ? item : {};
    return {
        id: String(source.id || source.runId || `run-${index + 1}`),
        commandId: String(source.commandId || source.pipelineId || source.command || ""),
        commandLabel: String(source.commandLabel || source.command || source.pipeline || source.commandId || `run-${index + 1}`),
        worktreePath: String(source.worktreePath || source.worktree || source.cwd || ""),
        cwd: source.cwd ? String(source.cwd) : undefined,
        status: normalizeStatus(source.status || "running"),
        startedAt: source.startedAt ? String(source.startedAt) : undefined,
        endedAt: source.endedAt ? String(source.endedAt) : undefined,
        exitCode: typeof source.exitCode === "number" ? source.exitCode : null,
        pid: typeof source.pid === "number" ? source.pid : undefined,
        logFile: String(source.logFile || source.log_file || ""),
    };
}

function normalizeLogs(items: unknown[]): RunLogEntry[] {
    return items.map(normalizeLogEntry).filter((entry): entry is RunLogEntry => Boolean(entry));
}

function normalizeLogEntry(item: unknown): RunLogEntry | null {
    if (!isRecord(item)) return null;
    return {
        time: String(item.time || new Date().toISOString()),
        stream: String(item.stream || "system"),
        text: String(item.text || item.message || ""),
    };
}

function toConfigAction(action: WorktreeAction): WorktreeAction {
    const command = action.command?.trim();
    const packageScript = action.packageScript?.trim();
    return {
        id: action.id.trim(),
        label: action.label.trim(),
        type: action.type || "custom",
        kind: packageScript ? "package-script" : command ? "shell" : action.kind,
        mode: action.mode || "one-shot",
        cwd: action.cwd?.trim() || ".",
        packageScript: packageScript || undefined,
        command: command || undefined,
        visible: action.visible !== false,
        confirm: action.confirm === true,
    };
}

function validateActions(actions: WorktreeAction[]) {
    const ids = new Set<string>();
    for (const action of actions) {
        const id = action.id.trim();
        if (!id) return "Action ID is required";
        if (ids.has(id)) return `Duplicate action ID: ${id}`;
        ids.add(id);
        if (!action.label.trim()) return `Label is required for ${id}`;
        if (!action.packageScript?.trim() && !action.command?.trim()) return `${id} needs packageScript or command`;
    }
    return "";
}

function createBlankAction(id = "new.action"): WorktreeAction {
    return {
        id,
        label: "New action",
        type: "custom",
        mode: "one-shot",
        cwd: ".",
        packageScript: "",
        command: "",
        visible: true,
        confirm: false,
    };
}

function uniqueActionId(actions: WorktreeAction[]) {
    let index = actions.length + 1;
    let id = `action.${index}`;
    const ids = new Set(actions.map((action) => action.id));
    while (ids.has(id)) {
        index += 1;
        id = `action.${index}`;
    }
    return id;
}

function upsertRun(runs: RunInfo[], run: RunInfo) {
    const index = runs.findIndex((item) => item.id === run.id);
    if (index === -1) return [run, ...runs];
    return runs.map((item, itemIndex) => (itemIndex === index ? run : item));
}

function commandLine(action: WorktreeAction) {
    if (action.command) return action.command;
    if (action.shell) return action.shell;
    if (action.packageScript) return `package run ${action.packageScript}`;
    return action.id;
}

function formatTime(value?: string) {
    if (!value) return "no time";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatLogEntry(entry: RunLogEntry) {
    return `[${entry.time}] ${entry.stream}: ${entry.text}`;
}

function parseEventData(data: string): unknown {
    try {
        return JSON.parse(data);
    } catch {
        return { text: data };
    }
}

function basename(path: string) {
    return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function slug(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.+|\.+$/g, "");
}

function isConfigEnvelope(value: unknown): value is ConfigEnvelope {
    return isRecord(value) && isRecord(value.config);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
