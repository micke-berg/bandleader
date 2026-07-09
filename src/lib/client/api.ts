/**
 * Client-side API access: typed fetchers over the route handlers plus the
 * per-task SSE stream. Client-safe by construction — only `import type`
 * from server modules, no node built-ins.
 */

import type { ProviderId } from "../adapters";
import type { DecisionRecord, ModelRef, RouterEvent } from "../router";
import type {
  PlanWindow,
  TaskInput,
  TaskRecord,
  TaskStreamEvent,
} from "../tasks/types";
import type { MisrouteFlags } from "../telemetry/flags";
import type { TelemetryStats } from "../telemetry/read";
import type { ProjectEntry } from "../status/projects";

export interface ProviderStatusView {
  provider: ProviderId;
  binaryPath: string | null;
  loginArtifact: boolean;
  planWindow?: PlanWindow;
}

export interface StatusView {
  providers: ProviderStatusView[];
  overrideOptions: ModelRef[];
}

export interface TelemetryView {
  decisions: DecisionRecord[];
  stats: TelemetryStats;
  flags: MisrouteFlags;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${path}: invalid response (${response.status})`);
  }
  const envelope = payload as
    | { ok: true; data: T }
    | { ok: false; error?: { message?: string } };
  if (envelope.ok !== true) {
    throw new Error(envelope.error?.message ?? `${path} failed (${response.status})`);
  }
  return envelope.data;
}

export function listTasks(): Promise<{ tasks: TaskRecord[] }> {
  return api("/api/tasks");
}

export function createTask(input: TaskInput): Promise<{ task: TaskRecord }> {
  return api("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getTask(
  id: string,
): Promise<{ task: TaskRecord; events: RouterEvent[] }> {
  return api(`/api/tasks/${encodeURIComponent(id)}`);
}

export function getStatus(): Promise<StatusView> {
  return api("/api/status");
}

export function getProjects(): Promise<{ projects: ProjectEntry[] }> {
  return api("/api/projects");
}

export function getTelemetry(): Promise<TelemetryView> {
  return api("/api/telemetry");
}

export function setMisrouteFlag(
  taskId: string,
  flagged: boolean,
  note?: string,
): Promise<{ flags: MisrouteFlags }> {
  return api("/api/telemetry/flags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, flagged, note }),
  });
}

/**
 * Subscribe to a task's SSE stream. Returns a cleanup function. The
 * server closes the stream after the terminal task snapshot; we treat a
 * post-terminal error event as the normal end of stream.
 */
export function openTaskStream(
  id: string,
  onEvent: (event: TaskStreamEvent) => void,
  onEnd: (error?: string) => void,
): () => void {
  const source = new EventSource(`/api/tasks/${encodeURIComponent(id)}/stream`);
  let sawTerminal = false;
  source.onmessage = (message) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.data as string);
    } catch {
      return;
    }
    const event = parsed as TaskStreamEvent;
    if (
      event.type === "task" &&
      (event.task.status === "done" || event.task.status === "failed")
    ) {
      sawTerminal = true;
    }
    onEvent(event);
    if (sawTerminal) {
      source.close();
      onEnd();
    }
  };
  source.onerror = () => {
    source.close();
    onEnd(sawTerminal ? undefined : "stream disconnected");
  };
  return () => source.close();
}
