import { describe, expect, it } from "vitest";

import type { NormalizedEvent } from "../adapters";
import type { RouterEvent } from "../router";
import { foldEvents } from "./transcript";

const decision: RouterEvent = {
  type: "decision",
  decision: {
    tier: "mid",
    provider: "claude",
    model: "sonnet",
    decidedBy: "rules",
    reason: "agentic repo task starts at mid",
    layers: ["rules"],
    fingerprint: "abcd",
    modelPinned: false,
  },
};

function provider(event: NormalizedEvent): RouterEvent {
  return { type: "provider_event", event };
}

describe("foldEvents", () => {
  it("merges consecutive text deltas into one prose block", () => {
    const items = foldEvents([
      decision,
      { type: "attempt_started", tier: "mid", provider: "claude", model: "sonnet" },
      provider({ type: "text_delta", text: "Hello " }),
      provider({ type: "text_delta", text: "world" }),
    ]);
    const prose = items.filter((i) => i.kind === "prose");
    expect(prose).toEqual([{ kind: "prose", text: "Hello world" }]);
  });

  it("keeps prose blocks separated by tool calls apart", () => {
    const items = foldEvents([
      provider({ type: "text_delta", text: "before" }),
      provider({ type: "tool_call", name: "Bash", summary: '{"command":"ls"}' }),
      provider({ type: "text_delta", text: "after" }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["prose", "tool", "prose"]);
  });

  it("maps pipeline markers to labeled meta rows with tones", () => {
    const items = foldEvents([
      decision,
      {
        type: "failover",
        failover: {
          from: { provider: "claude", model: "sonnet" },
          to: { provider: "codex", model: "gpt-5.6-terra" },
          detail: "rate limited",
        },
      },
      { type: "verifying", verifier: "shell" },
      {
        type: "escalated",
        escalation: {
          fromTier: "mid",
          toTier: "frontier",
          trigger: "verifier",
          verifier: "shell",
          detail: "`npm run typecheck` failed",
        },
      },
    ]);
    const meta = items.filter((i) => i.kind === "meta");
    expect(meta.map((m) => m.label)).toEqual([
      "routed",
      "failover",
      "verifying",
      "escalated",
    ]);
    expect(meta[1]?.tone).toBe("warn");
    expect(meta[3]?.tone).toBe("purple");
    expect(meta[3]?.text).toContain("mid → frontier");
  });

  it("hides plan_window heartbeats, completed, and result rows", () => {
    const items = foldEvents([
      provider({ type: "plan_window", provider: "claude", status: "allowed" }),
      provider({ type: "completed", resultText: "done", sessionId: "s" }),
    ]);
    expect(items).toEqual([]);
  });

  it("renders usage with token counts and plan-equivalent cost", () => {
    const items = foldEvents([
      provider({ type: "usage", inputTokens: 8356, outputTokens: 4, costUsd: 0.17 }),
    ]);
    expect(items[0]).toMatchObject({ kind: "meta", label: "usage" });
    expect((items[0] as { text: string }).text).toContain("8.4k");
    expect((items[0] as { text: string }).text).toContain("$0.17");
  });
});
