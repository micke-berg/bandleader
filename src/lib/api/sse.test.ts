import { describe, expect, it } from "vitest";

import { formatSseEvent, sseHeartbeat } from "./sse";

describe("formatSseEvent", () => {
  it("frames a JSON payload as a data line with a blank-line terminator", () => {
    expect(formatSseEvent({ type: "task", n: 1 })).toBe(
      'data: {"type":"task","n":1}\n\n',
    );
  });

  it("includes event and id fields when given", () => {
    expect(formatSseEvent({ a: 1 }, { event: "router", id: "42" })).toBe(
      'event: router\nid: 42\ndata: {"a":1}\n\n',
    );
  });

  it("keeps framing valid for payloads with embedded newline escapes", () => {
    const framed = formatSseEvent({ text: "line one\nline two" });
    // JSON escapes the newline, so it must stay on a single data line.
    expect(framed).toBe('data: {"text":"line one\\nline two"}\n\n');
    expect(framed.split("\n\n")).toHaveLength(2);
  });

  it("serializes undefined as null rather than emitting invalid frames", () => {
    expect(formatSseEvent(undefined)).toBe("data: null\n\n");
  });
});

describe("sseHeartbeat", () => {
  it("is a comment frame", () => {
    expect(sseHeartbeat()).toBe(": heartbeat\n\n");
  });
});
