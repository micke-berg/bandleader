import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DecisionLog, type DecisionRecord } from "./decision-log";

function record(taskId: string): DecisionRecord {
  return {
    v: 1,
    ts: "2026-07-10T10:00:00.000Z",
    taskId,
    fingerprint: "abcdef0123456789",
    kind: "task",
    promptChars: 42,
    layers: ["rules", "classifier"],
    decidedBy: "classifier",
    reason: "classifier: ordinary change (confidence 0.85)",
    tier: "mid",
    provider: "claude",
    model: "sonnet",
    final: { tier: "mid", provider: "claude", model: "sonnet" },
    attempts: [
      { tier: "mid", provider: "claude", model: "sonnet", outcome: "completed" },
    ],
    failovers: [],
    escalation: null,
    outcome: "verified",
    usage: { inputTokens: 10, outputTokens: 5 },
    durationMs: 1234,
  };
}

describe("DecisionLog", () => {
  it("appends one parseable JSON line per record and creates the directory", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bandleader-log-"));
    const file = path.join(dir, "nested", "decisions.jsonl");
    const log = new DecisionLog(file);

    log.append(record("task-1"));
    log.append(record("task-2"));

    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const parsed = lines.map((line) => JSON.parse(line) as DecisionRecord);
    expect(parsed[0]?.taskId).toBe("task-1");
    expect(parsed[1]?.taskId).toBe("task-2");
    expect(parsed[0]?.v).toBe(1);
    expect(parsed[0]?.final.model).toBe("sonnet");
  });
});
