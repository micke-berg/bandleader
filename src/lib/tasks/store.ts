import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { RouterEvent } from "../router";
import type { PlanWindow, TaskRecord } from "./types";

/**
 * Disk persistence for the task manager, all under the gitignored data
 * dir. Task records are an append-only JSONL of full snapshots — the
 * last line per id wins on load, so a crash mid-append costs at most one
 * transition, never the file. Each task's RouterEvents append to their
 * own JSONL so task detail survives a restart.
 */

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Task ids are UUIDs; enforce before using one in a file path. */
export function isSafeTaskId(id: string): boolean {
  return /^[0-9a-f-]{8,64}$/i.test(id);
}

export class TaskStore {
  private readonly dataDir: string;
  private readonly tasksFile: string;
  private readonly eventsDir: string;
  private readonly planWindowsFile: string;

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir);
    this.tasksFile = path.join(this.dataDir, "tasks.jsonl");
    this.eventsDir = path.join(this.dataDir, "task-events");
    this.planWindowsFile = path.join(this.dataDir, "plan-windows.json");
  }

  appendTask(task: TaskRecord): void {
    mkdirSync(this.dataDir, { recursive: true });
    appendFileSync(this.tasksFile, `${JSON.stringify(task)}\n`, "utf8");
  }

  /** Last snapshot per id wins; malformed lines are skipped. */
  loadTasks(): TaskRecord[] {
    let raw: string;
    try {
      raw = readFileSync(this.tasksFile, "utf8");
    } catch {
      return [];
    }
    const byId = new Map<string, TaskRecord>();
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      const parsed = parseLine(line);
      if (
        isRecord(parsed) &&
        parsed.v === 1 &&
        typeof parsed.id === "string" &&
        typeof parsed.status === "string"
      ) {
        const task = parsed as unknown as TaskRecord;
        byId.delete(task.id); // re-insert so later snapshots sort later
        byId.set(task.id, task);
      }
    }
    return [...byId.values()];
  }

  appendEvent(taskId: string, event: RouterEvent): void {
    if (!isSafeTaskId(taskId)) return;
    mkdirSync(this.eventsDir, { recursive: true });
    appendFileSync(
      path.join(this.eventsDir, `${taskId}.jsonl`),
      `${JSON.stringify(event)}\n`,
      "utf8",
    );
  }

  loadEvents(taskId: string): RouterEvent[] {
    if (!isSafeTaskId(taskId)) return [];
    let raw: string;
    try {
      raw = readFileSync(path.join(this.eventsDir, `${taskId}.jsonl`), "utf8");
    } catch {
      return [];
    }
    const events: RouterEvent[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      const parsed = parseLine(line);
      if (isRecord(parsed) && typeof parsed.type === "string") {
        events.push(parsed as unknown as RouterEvent);
      }
    }
    return events;
  }

  /** Ids that have a persisted event file. */
  eventTaskIds(): string[] {
    try {
      return readdirSync(this.eventsDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => f.slice(0, -".jsonl".length));
    } catch {
      return [];
    }
  }

  savePlanWindows(windows: Record<string, PlanWindow>): void {
    mkdirSync(this.dataDir, { recursive: true });
    // Atomic: write to a tmp file, then rename over the old one.
    const tmp = `${this.planWindowsFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(windows, null, 2), "utf8");
    renameSync(tmp, this.planWindowsFile);
  }

  loadPlanWindows(): Record<string, PlanWindow> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.planWindowsFile, "utf8"));
    } catch {
      return {};
    }
    if (!isRecord(parsed)) return {};
    const windows: Record<string, PlanWindow> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (
        isRecord(value) &&
        typeof value.provider === "string" &&
        typeof value.status === "string" &&
        typeof value.observedAt === "string"
      ) {
        windows[key] = value as unknown as PlanWindow;
      }
    }
    return windows;
  }
}
