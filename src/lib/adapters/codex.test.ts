import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCodexLine } from "./codex";
import type { NormalizedEvent } from "./types";

function fixtureLines(name: string): string[] {
  const file = path.join(__dirname, "__fixtures__", name);
  return readFileSync(file, "utf8").split("\n").filter(Boolean);
}

function parseFixture(name: string): NormalizedEvent[] {
  return fixtureLines(name).flatMap(parseCodexLine);
}

describe("parseCodexLine on the one-shot fixture", () => {
  const events = parseFixture("codex-oneshot.jsonl");

  it("maps thread.started to session_started with the thread id", () => {
    expect(events[0]).toEqual({
      type: "session_started",
      sessionId: "019f48d1-11de-7221-bb7d-b0571ac1dc8d",
      model: "default",
      provider: "codex",
    });
  });

  it("maps the completed agent_message to text_delta", () => {
    const text = events.find((e) => e.type === "text_delta");
    expect(text?.text).toBe("ok");
  });

  it("extracts token usage from turn.completed", () => {
    expect(events.at(-1)).toEqual({
      type: "usage",
      inputTokens: 13694,
      outputTokens: 5,
    });
  });
});

describe("parseCodexLine on the resume fixture", () => {
  const events = parseFixture("codex-resume.jsonl");

  it("keeps the same thread id across the resumed run", () => {
    const started = events.find((e) => e.type === "session_started");
    expect(started?.sessionId).toBe("019f48d1-11de-7221-bb7d-b0571ac1dc8d");
  });
});

describe("parseCodexLine on the tool-call fixture", () => {
  const events = parseFixture("codex-toolcall.jsonl");

  it("maps command_execution item.started to a single tool_call", () => {
    const calls = events.filter((e) => e.type === "tool_call");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("command_execution");
    expect(calls[0]?.summary).toContain("echo hi");
  });

  it("keeps agent messages in order around the tool call", () => {
    const texts = events
      .filter((e) => e.type === "text_delta")
      .map((e) => e.text);
    expect(texts).toEqual(["Running it now.", "hi"]);
  });
});

describe("parseCodexLine tolerance and edge cases", () => {
  it("ignores malformed lines", () => {
    expect(parseCodexLine("")).toEqual([]);
    expect(parseCodexLine("not json")).toEqual([]);
    expect(parseCodexLine("[1,2,3")).toEqual([]);
    expect(parseCodexLine("null")).toEqual([]);
  });

  it("ignores unknown event and item types", () => {
    expect(parseCodexLine('{"type":"turn.started"}')).toEqual([]);
    expect(
      parseCodexLine('{"type":"item.completed","item":{"type":"reasoning"}}'),
    ).toEqual([]);
  });

  it("maps a rate-limit turn.failed to a retryable rate_limited event", () => {
    const line = JSON.stringify({
      type: "turn.failed",
      error: { message: "429 Too Many Requests: usage limit reached" },
    });
    expect(parseCodexLine(line)).toEqual([
      {
        type: "rate_limited",
        retryable: true,
        detail: "429 Too Many Requests: usage limit reached",
      },
    ]);
  });

  it("maps other turn.failed errors to error events", () => {
    const line = JSON.stringify({
      type: "turn.failed",
      error: { message: "sandbox denied write access" },
    });
    expect(parseCodexLine(line)).toEqual([
      { type: "error", detail: "sandbox denied write access" },
    ]);
  });

  it("maps top-level error events to error", () => {
    const line = JSON.stringify({ type: "error", message: "stream aborted" });
    expect(parseCodexLine(line)).toEqual([
      { type: "error", detail: "stream aborted" },
    ]);
  });
});
