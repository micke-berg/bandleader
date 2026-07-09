import { describe, expect, it } from "vitest";

import { parseMisrouteFlag, parseTaskInput, PROMPT_MAX_CHARS } from "./validate";

describe("parseTaskInput", () => {
  it("accepts a minimal chat body", () => {
    const parsed = parseTaskInput({ prompt: "hello", kind: "chat" });
    expect(parsed).toEqual({
      ok: true,
      value: {
        prompt: "hello",
        kind: "chat",
        cwd: undefined,
        override: undefined,
        permissionProfile: undefined,
      },
    });
  });

  it("accepts a full task body", () => {
    const parsed = parseTaskInput({
      prompt: "do the thing",
      kind: "task",
      cwd: "/tmp/repo",
      override: { provider: "claude", model: "opus", tier: "frontier" },
      permissionProfile: "workspace-write",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.cwd).toBe("/tmp/repo");
      expect(parsed.value.override).toEqual({
        provider: "claude",
        model: "opus",
        tier: "frontier",
      });
      expect(parsed.value.permissionProfile).toBe("workspace-write");
    }
  });

  it("rejects non-object, missing prompt, and oversized prompt", () => {
    expect(parseTaskInput(null).ok).toBe(false);
    expect(parseTaskInput("x").ok).toBe(false);
    expect(parseTaskInput([]).ok).toBe(false);
    expect(parseTaskInput({ kind: "chat" }).ok).toBe(false);
    expect(parseTaskInput({ prompt: "   ", kind: "chat" }).ok).toBe(false);
    expect(
      parseTaskInput({ prompt: "x".repeat(PROMPT_MAX_CHARS + 1), kind: "chat" })
        .ok,
    ).toBe(false);
  });

  it("rejects a bad kind, relative cwd, and unknown enum values", () => {
    expect(parseTaskInput({ prompt: "x", kind: "job" }).ok).toBe(false);
    expect(parseTaskInput({ prompt: "x", kind: "task", cwd: "repo" }).ok).toBe(
      false,
    );
    expect(
      parseTaskInput({ prompt: "x", kind: "chat", override: { provider: "gemini" } })
        .ok,
    ).toBe(false);
    expect(
      parseTaskInput({ prompt: "x", kind: "chat", override: { tier: "ultra" } }).ok,
    ).toBe(false);
    expect(
      parseTaskInput({ prompt: "x", kind: "chat", permissionProfile: "root" }).ok,
    ).toBe(false);
  });

  it("treats an empty override object as no override", () => {
    const parsed = parseTaskInput({ prompt: "x", kind: "chat", override: {} });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.override).toBeUndefined();
  });

  it("treats an empty cwd as no cwd", () => {
    const parsed = parseTaskInput({ prompt: "x", kind: "chat", cwd: "" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.cwd).toBeUndefined();
  });
});

describe("parseMisrouteFlag", () => {
  it("accepts a valid flag body", () => {
    const parsed = parseMisrouteFlag({
      taskId: "3ff2ec17-4b63-48de-9e34-119d10cd6e51",
      flagged: true,
      note: "cheap would have done",
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        taskId: "3ff2ec17-4b63-48de-9e34-119d10cd6e51",
        flagged: true,
        note: "cheap would have done",
      },
    });
  });

  it("rejects bad ids and non-boolean flags", () => {
    expect(parseMisrouteFlag({ taskId: "../../etc", flagged: true }).ok).toBe(
      false,
    );
    expect(parseMisrouteFlag({ taskId: "abc", flagged: true }).ok).toBe(false);
    expect(
      parseMisrouteFlag({ taskId: "3ff2ec17-4b63-48de-9e34-119d10cd6e51", flagged: "yes" })
        .ok,
    ).toBe(false);
  });
});
