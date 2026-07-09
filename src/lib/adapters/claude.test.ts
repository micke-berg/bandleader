import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeLine } from "./claude";
import type { NormalizedEvent } from "./types";

function fixtureLines(name: string): string[] {
  const file = path.join(__dirname, "__fixtures__", name);
  return readFileSync(file, "utf8").split("\n").filter(Boolean);
}

function parseFixture(name: string): NormalizedEvent[] {
  return fixtureLines(name).flatMap(parseClaudeLine);
}

describe("parseClaudeLine on the one-shot fixture", () => {
  const events = parseFixture("claude-oneshot.ndjson");

  it("maps system/init to session_started with session id and model", () => {
    expect(events[0]).toEqual({
      type: "session_started",
      sessionId: "68100210-af6f-4fbc-ad50-8c5eccc6ff02",
      model: "claude-opus-4-8[1m]",
      provider: "claude",
    });
  });

  it("collects the streamed text deltas", () => {
    const text = events
      .filter((e) => e.type === "text_delta")
      .map((e) => e.text)
      .join("");
    expect(text).toBe("ok");
  });

  it("extracts usage including total_cost_usd from the result event", () => {
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toEqual({
      type: "usage",
      inputTokens: 8356,
      outputTokens: 4,
      costUsd: 0.32795,
    });
  });

  it("maps the final result to completed with result text and session id", () => {
    expect(events.at(-1)).toEqual({
      type: "completed",
      resultText: "ok",
      sessionId: "68100210-af6f-4fbc-ad50-8c5eccc6ff02",
    });
  });

  it("does not emit rate_limited for an allowed rate_limit_event heartbeat", () => {
    expect(events.some((e) => e.type === "rate_limited")).toBe(false);
  });
});

describe("parseClaudeLine on the resume fixture", () => {
  const events = parseFixture("claude-resume.ndjson");

  it("keeps the same session id across the resumed run", () => {
    const started = events.find((e) => e.type === "session_started");
    const completed = events.find((e) => e.type === "completed");
    expect(started?.sessionId).toBe("68100210-af6f-4fbc-ad50-8c5eccc6ff02");
    expect(completed?.sessionId).toBe("68100210-af6f-4fbc-ad50-8c5eccc6ff02");
  });
});

describe("parseClaudeLine on the tool-call fixture", () => {
  const events = parseFixture("claude-toolcall.ndjson");

  it("maps assistant tool_use blocks to tool_call with a summary", () => {
    const call = events.find((e) => e.type === "tool_call");
    expect(call?.name).toBe("Bash");
    expect(call?.summary).toContain("echo hi");
  });

  it("still completes with the final answer", () => {
    const completed = events.find((e) => e.type === "completed");
    expect(completed?.resultText).toBe("hi");
  });
});

describe("parseClaudeLine tolerance and edge cases", () => {
  it("ignores malformed lines", () => {
    expect(parseClaudeLine("")).toEqual([]);
    expect(parseClaudeLine("not json at all")).toEqual([]);
    expect(parseClaudeLine("{truncated")).toEqual([]);
    expect(parseClaudeLine("42")).toEqual([]);
    expect(parseClaudeLine('"just a string"')).toEqual([]);
  });

  it("ignores unknown event types and system subtypes", () => {
    expect(parseClaudeLine('{"type":"mystery"}')).toEqual([]);
    expect(
      parseClaudeLine('{"type":"system","subtype":"hook_started"}'),
    ).toEqual([]);
  });

  it("maps a rate-limit api_retry to a retryable rate_limited event", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "api_retry",
      error: "rate_limit_error: overloaded, retrying in 8s",
    });
    expect(parseClaudeLine(line)).toEqual([
      {
        type: "rate_limited",
        retryable: true,
        detail: "rate_limit_error: overloaded, retrying in 8s",
      },
    ]);
  });

  it("ignores api_retry lines that are not rate limits", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "api_retry",
      error: "connection reset, retrying",
    });
    expect(parseClaudeLine(line)).toEqual([]);
  });

  it("maps a non-allowed rate_limit_event to rate_limited", () => {
    const line = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", rateLimitType: "five_hour" },
    });
    expect(parseClaudeLine(line)).toEqual([
      {
        type: "rate_limited",
        retryable: true,
        detail: "plan rate limit status: rejected",
      },
    ]);
  });

  it("maps an error result to an error event with usage still emitted", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "something broke",
      session_id: "s-1",
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    const events = parseClaudeLine(line);
    expect(events[0]?.type).toBe("usage");
    expect(events[1]).toEqual({ type: "error", detail: "something broke" });
  });
});
