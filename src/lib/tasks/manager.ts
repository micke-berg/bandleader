import { randomUUID } from "node:crypto";

import type { ProviderId } from "../adapters";
import { route, type RouterDeps, type RouterEvent, type RouteRequest } from "../router";
import { TaskStore } from "./store";
import {
  isTerminalStatus,
  type PlanWindow,
  type TaskInput,
  type TaskRecord,
  type TaskStatus,
  type TaskStreamEvent,
} from "./types";

/**
 * The task manager: creates tasks, runs each one through the router
 * pipeline in the background, buffers its RouterEvents for SSE replay,
 * persists every state transition, and fans events out to subscribers.
 *
 * One instance lives for the whole server process (see instance.ts).
 */

const TITLE_MAX = 80;

export function taskTitle(prompt: string): string {
  const firstLine = prompt.trim().split("\n", 1)[0] ?? "";
  return firstLine.length > TITLE_MAX
    ? `${firstLine.slice(0, TITLE_MAX)}…`
    : firstLine;
}

export interface TaskManagerOptions {
  deps: RouterDeps;
  /** Defaults to deps.config.dataDir. */
  dataDir?: string;
  now?: () => Date;
  id?: () => string;
}

type Listener = (event: TaskStreamEvent) => void;

export class TaskManager {
  private readonly deps: RouterDeps;
  private readonly store: TaskStore;
  private readonly now: () => Date;
  private readonly makeId: () => string;

  private readonly tasks = new Map<string, TaskRecord>();
  private readonly buffers = new Map<string, RouterEvent[]>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly planWindows = new Map<string, PlanWindow>();

  constructor(options: TaskManagerOptions) {
    this.deps = options.deps;
    this.store = new TaskStore(options.dataDir ?? options.deps.config.dataDir);
    this.now = options.now ?? (() => new Date());
    this.makeId = options.id ?? randomUUID;

    for (const task of this.store.loadTasks()) {
      // A non-terminal task on load means the server died mid-run: the
      // pipeline is gone, so record that honestly instead of showing a
      // task that spins forever.
      if (!isTerminalStatus(task.status)) {
        const failed: TaskRecord = {
          ...task,
          status: "failed",
          error: "interrupted by a server restart",
          updatedAt: this.now().toISOString(),
          finishedAt: this.now().toISOString(),
        };
        this.store.appendTask(failed);
        this.tasks.set(failed.id, failed);
      } else {
        this.tasks.set(task.id, task);
      }
    }
    for (const [provider, window] of Object.entries(
      this.store.loadPlanWindows(),
    )) {
      this.planWindows.set(provider, window);
    }
  }

  create(input: TaskInput): TaskRecord {
    const ts = this.now().toISOString();
    const task: TaskRecord = {
      v: 1,
      id: this.makeId(),
      title: taskTitle(input.prompt),
      prompt: input.prompt,
      kind: input.kind,
      cwd: input.cwd,
      override: input.override,
      permissionProfile: input.permissionProfile ?? "read-only",
      status: "routing",
      createdAt: ts,
      updatedAt: ts,
    };
    this.tasks.set(task.id, task);
    this.buffers.set(task.id, []);
    this.store.appendTask(task);
    void this.run(task.id);
    return task;
  }

  /** Newest first. */
  list(): TaskRecord[] {
    return [...this.tasks.values()].sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.id.localeCompare(b.id)
        : a.createdAt < b.createdAt
          ? 1
          : -1,
    );
  }

  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  /** Buffered events for a live task, or the persisted ones after a restart. */
  events(id: string): RouterEvent[] {
    return this.buffers.get(id) ?? this.store.loadEvents(id);
  }

  subscribe(id: string, listener: Listener): () => void {
    let set = this.listeners.get(id);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(id);
    };
  }

  getPlanWindows(): Partial<Record<ProviderId, PlanWindow>> {
    return Object.fromEntries(this.planWindows) as Partial<
      Record<ProviderId, PlanWindow>
    >;
  }

  private emit(id: string, event: TaskStreamEvent): void {
    const set = this.listeners.get(id);
    if (set === undefined) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must never take the pipeline down.
      }
    }
  }

  private update(id: string, patch: Partial<TaskRecord>): TaskRecord {
    const current = this.tasks.get(id);
    if (current === undefined) throw new Error(`unknown task ${id}`);
    const next: TaskRecord = {
      ...current,
      ...patch,
      updatedAt: this.now().toISOString(),
    };
    this.tasks.set(id, next);
    this.store.appendTask(next);
    this.emit(id, { type: "task", task: next });
    return next;
  }

  private observePlanWindow(event: RouterEvent): void {
    if (event.type !== "provider_event") return;
    const inner = event.event;
    if (inner.type !== "plan_window") return;
    this.planWindows.set(inner.provider, {
      provider: inner.provider,
      status: inner.status,
      resetsAt: inner.resetsAt,
      windowType: inner.windowType,
      observedAt: this.now().toISOString(),
    });
    this.store.savePlanWindows(Object.fromEntries(this.planWindows));
  }

  /** Map a RouterEvent onto the task's status/summary fields. */
  private apply(id: string, event: RouterEvent): void {
    switch (event.type) {
      case "decision": {
        const { tier, provider, model, decidedBy, reason } = event.decision;
        this.update(id, { decision: { tier, provider, model, decidedBy, reason } });
        return;
      }
      case "attempt_started":
        this.update(id, { status: "running" });
        return;
      case "verifying":
        this.update(id, { status: "verifying" });
        return;
      case "escalated":
        this.update(id, { status: "escalated" });
        return;
      case "result": {
        const r = event.result;
        const status: TaskStatus =
          r.outcome === "completed" || r.outcome === "verified"
            ? "done"
            : "failed";
        this.update(id, {
          status,
          finishedAt: this.now().toISOString(),
          result: {
            outcome: r.outcome,
            finalTier: r.finalTier,
            finalProvider: r.finalProvider,
            finalModel: r.finalModel,
            reason: r.reason,
            resultText: r.resultText,
            escalated: r.escalated,
            failovers: r.failovers.length,
            sessionId: r.sessionId,
            usage: r.usage,
            durationMs: r.durationMs,
          },
        });
        return;
      }
      default:
        return; // provider_event / failover don't change task status
    }
  }

  private async run(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (task === undefined) return;
    const request: RouteRequest = {
      prompt: task.prompt,
      kind: task.kind,
      cwd: task.cwd,
      override: task.override,
      permissionProfile: task.permissionProfile,
    };
    try {
      for await (const event of route(request, this.deps)) {
        this.buffers.get(id)?.push(event);
        this.store.appendEvent(id, event);
        this.observePlanWindow(event);
        this.emit(id, { type: "router", event });
        this.apply(id, event);
      }
    } catch (err) {
      // route() catches pipeline errors itself; this guards infra
      // failures (bad config, unwritable data dir, ...).
      this.update(id, {
        status: "failed",
        finishedAt: this.now().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
