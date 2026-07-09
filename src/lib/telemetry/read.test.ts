import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { DecisionRecord } from "../router";
import { aggregateDecisions, parseDecisionLine, readDecisions } from "./read";

function record(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    v: 1,
    ts: "2026-07-10T12:00:00.000Z",
    taskId: "3ff2ec17-4b63-48de-9e34-119d10cd6e51",
    fingerprint: "abcd1234",
    kind: "chat",
    promptChars: 40,
    layers: ["rules"],
    decidedBy: "rules",
    reason: "hard rule: quick chat question routes cheap",
    tier: "cheap",
    provider: "claude",
    model: "haiku",
    final: { tier: "cheap", provider: "claude", model: "haiku" },
    attempts: [],
    failovers: [],
    escalation: null,
    outcome: "completed",
    usage: { costUsd: 0.03 },
    durationMs: 1200,
    ...overrides,
  };
}

describe("parseDecisionLine", () => {
  it("parses a v1 record and rejects junk", () => {
    expect(parseDecisionLine(JSON.stringify(record()))?.model).toBe("haiku");
    expect(parseDecisionLine("not json")).toBeUndefined();
    expect(parseDecisionLine('{"v":2,"ts":"x"}')).toBeUndefined();
    expect(parseDecisionLine('{"v":1}')).toBeUndefined();
  });
});

describe("readDecisions", () => {
  it("returns newest first, skips malformed lines, respects the limit", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bandleader-telemetry-"));
    const file = path.join(dir, "decisions.jsonl");
    const lines = [
      JSON.stringify(record({ taskId: "aaaaaaaa-0000-0000-0000-000000000001" })),
      "garbage line",
      JSON.stringify(record({ taskId: "aaaaaaaa-0000-0000-0000-000000000002" })),
      JSON.stringify(record({ taskId: "aaaaaaaa-0000-0000-0000-000000000003" })),
    ];
    writeFileSync(file, `${lines.join("\n")}\n`, "utf8");

    const all = readDecisions(file, 10);
    expect(all.map((r) => r.taskId.slice(-1))).toEqual(["3", "2", "1"]);
    expect(readDecisions(file, 2)).toHaveLength(2);
    expect(readDecisions(path.join(dir, "missing.jsonl"), 10)).toEqual([]);
  });
});

describe("aggregateDecisions", () => {
  it("computes tier/provider counts, escalations, failovers, and cost", () => {
    const records: DecisionRecord[] = [
      record(),
      record({
        outcome: "verify_failed",
        final: { tier: "mid", provider: "codex", model: "gpt-5.6-terra" },
        failovers: [
          {
            from: { provider: "claude", model: "sonnet" },
            to: { provider: "codex", model: "gpt-5.6-terra" },
            detail: "rate limited",
          },
        ],
        layers: ["rules", "classifier"],
        usage: {},
      }),
      record({
        escalation: {
          fromTier: "mid",
          toTier: "frontier",
          trigger: "verifier",
          verifier: "shell",
          detail: "typecheck failed",
        },
        final: { tier: "frontier", provider: "claude", model: "opus" },
        outcome: "verified",
        usage: { costUsd: 0.5 },
      }),
    ];
    const stats = aggregateDecisions(records);
    expect(stats.total).toBe(3);
    expect(stats.byTier).toEqual({ cheap: 1, mid: 1, frontier: 1 });
    expect(stats.byFinalProvider).toEqual({ claude: 2, codex: 1 });
    expect(stats.escalations).toBe(1);
    expect(stats.failovers).toBe(1);
    expect(stats.verifyFailed).toBe(1);
    expect(stats.errors).toBe(0);
    expect(stats.totalCostUsd).toBeCloseTo(0.53);
    expect(stats.classifierRuns).toBe(1);
  });
});
