import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { NormalizedEvent, ProviderId } from "../adapters";
import { defineConfig, type BandleaderConfig } from "../router/config";
import { FakeAdapter, errorEvents, okEvents } from "../router/testing";
import type { RouterDeps } from "../router";
import { TaskManager, taskTitle } from "./manager";
import { TaskStore } from "./store";
import type { TaskRecord, TaskStatus } from "./types";

function testConfig(dataDir: string): BandleaderConfig {
  return defineConfig({
    tiers: {
      cheap: { preference: [{ provider: "claude", model: "fake-cheap" }] },
      mid: { preference: [{ provider: "claude", model: "fake-mid" }] },
      frontier: { preference: [{ provider: "claude", model: "fake-frontier" }] },
    },
    rules: {
      frontierKeywords: ["architecture"],
      midPromptChars: 1_000,
      frontierPromptChars: 5_000,
    },
    classifier: { provider: "claude", model: "fake-classifier", minConfidence: 0.6 },
    verifyCommands: [],
    dataDir,
  });
}

const MODELS = ["fake-cheap", "fake-mid", "fake-frontier", "fake-classifier"];

function makeDeps(
  dataDir: string,
  script: (opts: { model?: string }) => NormalizedEvent[],
): RouterDeps {
  const claude = new FakeAdapter("claude", MODELS, script);
  const codex = new FakeAdapter("codex", ["fake-codex"], () =>
    okEvents("codex", "ok"),
  );
  return { config: testConfig(dataDir), adapters: { claude, codex } };
}

function tmpDataDir(): string {
  return mkdtempSync(path.join(tmpdir(), "bandleader-tasks-"));
}

/** Resolve once the task reaches a terminal status. */
function waitForTerminal(manager: TaskManager, id: string): Promise<TaskRecord> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("task never finished")),
      5_000,
    );
    const check = (task: TaskRecord | undefined): void => {
      if (task !== undefined && (task.status === "done" || task.status === "failed")) {
        clearTimeout(timer);
        unsubscribe();
        resolve(task);
      }
    };
    const unsubscribe = manager.subscribe(id, (event) => {
      if (event.type === "task") check(event.task);
    });
    check(manager.get(id));
  });
}

describe("taskTitle", () => {
  it("uses the first line and caps the length", () => {
    expect(taskTitle("Fix the bug\nin detail")).toBe("Fix the bug");
    expect(taskTitle(`${"x".repeat(100)}`)).toHaveLength(81); // 80 + ellipsis
  });
});

describe("TaskManager state transitions", () => {
  it("runs a chat task through routing → running → done with a result summary", async () => {
    const dataDir = tmpDataDir();
    const manager = new TaskManager({
      deps: makeDeps(dataDir, () => okEvents("claude", "the answer")),
    });

    const statuses: TaskStatus[] = [];
    const task = manager.create({ prompt: "Quick question?", kind: "chat" });
    expect(task.status).toBe("routing");
    manager.subscribe(task.id, (event) => {
      if (event.type === "task") statuses.push(event.task.status);
    });

    const finished = await waitForTerminal(manager, task.id);
    expect(finished.status).toBe("done");
    expect(statuses).toContain("running");
    expect(finished.decision?.model).toBe("fake-cheap");
    expect(finished.decision?.reason).toBeTruthy();
    expect(finished.result?.outcome).toBe("completed");
    expect(finished.result?.finalModel).toBe("fake-cheap");
    expect(finished.result?.resultText).toBe("the answer");
    expect(finished.finishedAt).toBeTruthy();
  });

  it("marks a task failed when every attempt errors", async () => {
    const dataDir = tmpDataDir();
    const manager = new TaskManager({
      deps: makeDeps(dataDir, () => errorEvents("claude", "boom")),
    });
    const task = manager.create({ prompt: "Quick question?", kind: "chat" });
    const finished = await waitForTerminal(manager, task.id);
    expect(finished.status).toBe("failed");
    expect(finished.result?.outcome).toBe("error");
  });

  it("honors an explicit model override in the decision", async () => {
    const dataDir = tmpDataDir();
    const manager = new TaskManager({
      deps: makeDeps(dataDir, () => okEvents("claude", "ok")),
    });
    const task = manager.create({
      prompt: "Quick question?",
      kind: "chat",
      override: { model: "fake-frontier" },
    });
    const finished = await waitForTerminal(manager, task.id);
    expect(finished.decision?.decidedBy).toBe("override");
    expect(finished.result?.finalModel).toBe("fake-frontier");
  });
});

describe("TaskManager persistence", () => {
  it("restores finished tasks and their events after a restart", async () => {
    const dataDir = tmpDataDir();
    const deps = makeDeps(dataDir, () => okEvents("claude", "persisted"));
    const first = new TaskManager({ deps });
    const task = first.create({ prompt: "Quick question?", kind: "chat" });
    await waitForTerminal(first, task.id);

    const second = new TaskManager({ deps });
    const restored = second.get(task.id);
    expect(restored?.status).toBe("done");
    expect(restored?.result?.resultText).toBe("persisted");
    const events = second.events(task.id);
    expect(events.some((e) => e.type === "decision")).toBe(true);
    expect(events.at(-1)?.type).toBe("result");
  });

  it("fails tasks that were still running when the process died", () => {
    const dataDir = tmpDataDir();
    const store = new TaskStore(dataDir);
    const stuck: TaskRecord = {
      v: 1,
      id: "11111111-2222-3333-4444-555555555555",
      title: "stuck",
      prompt: "stuck",
      kind: "chat",
      permissionProfile: "read-only",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.appendTask(stuck);

    const manager = new TaskManager({
      deps: makeDeps(dataDir, () => okEvents("claude", "ok")),
    });
    const restored = manager.get(stuck.id);
    expect(restored?.status).toBe("failed");
    expect(restored?.error).toMatch(/restart/);
  });

  it("lists tasks newest first", async () => {
    const dataDir = tmpDataDir();
    let tick = 0;
    const manager = new TaskManager({
      deps: makeDeps(dataDir, () => okEvents("claude", "ok")),
      now: () => new Date(2026, 6, 10, 12, 0, tick++),
    });
    const a = manager.create({ prompt: "first", kind: "chat" });
    const b = manager.create({ prompt: "second", kind: "chat" });
    await Promise.all([
      waitForTerminal(manager, a.id),
      waitForTerminal(manager, b.id),
    ]);
    expect(manager.list().map((t) => t.prompt)).toEqual(["second", "first"]);
  });
});

describe("TaskManager plan windows", () => {
  it("captures plan_window heartbeats and persists them across restarts", async () => {
    const dataDir = tmpDataDir();
    const script = (): NormalizedEvent[] => [
      {
        type: "session_started",
        sessionId: "s-1",
        model: "fake-cheap",
        provider: "claude" as ProviderId,
      },
      {
        type: "plan_window",
        provider: "claude",
        status: "allowed",
        resetsAt: "2026-07-10T22:50:00.000Z",
        windowType: "five_hour",
      },
      { type: "completed", resultText: "ok", sessionId: "s-1" },
    ];
    const deps = makeDeps(dataDir, script);
    const manager = new TaskManager({ deps });
    const task = manager.create({ prompt: "Quick question?", kind: "chat" });
    await waitForTerminal(manager, task.id);

    const window = manager.getPlanWindows().claude;
    expect(window?.status).toBe("allowed");
    expect(window?.resetsAt).toBe("2026-07-10T22:50:00.000Z");
    expect(existsSync(path.join(dataDir, "plan-windows.json"))).toBe(true);

    const second = new TaskManager({ deps });
    expect(second.getPlanWindows().claude?.resetsAt).toBe(
      "2026-07-10T22:50:00.000Z",
    );
  });
});
