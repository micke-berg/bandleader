import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FailureMemory } from "./memory";

function tmpFile(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "bandleader-mem-")), "memory.json");
}

describe("FailureMemory", () => {
  it("returns undefined for unknown fingerprints and missing files", () => {
    const memory = new FailureMemory(tmpFile());
    expect(memory.get("abc")).toBeUndefined();
  });

  it("persists escalations across instances", () => {
    const file = tmpFile();
    new FailureMemory(file).recordEscalation("abc", "frontier");
    expect(new FailureMemory(file).get("abc")).toBe("frontier");
  });

  it("never downgrades a remembered tier", () => {
    const file = tmpFile();
    const memory = new FailureMemory(file);
    memory.recordEscalation("abc", "frontier");
    memory.recordEscalation("abc", "mid");
    expect(new FailureMemory(file).get("abc")).toBe("frontier");
  });

  it("counts repeated escalations", () => {
    const file = tmpFile();
    const memory = new FailureMemory(file);
    memory.recordEscalation("abc", "mid");
    memory.recordEscalation("abc", "mid");
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      { count: number }
    >;
    expect(raw.abc?.count).toBe(2);
  });

  it("tolerates a corrupt memory file", () => {
    const file = tmpFile();
    writeFileSync(file, "{not json", "utf8");
    const memory = new FailureMemory(file);
    expect(memory.get("abc")).toBeUndefined();
    memory.recordEscalation("abc", "mid");
    expect(new FailureMemory(file).get("abc")).toBe("mid");
  });

  it("drops entries with invalid tiers instead of crashing", () => {
    const file = tmpFile();
    writeFileSync(
      file,
      JSON.stringify({ bad: { tier: "gigantic" }, good: { tier: "mid" } }),
      "utf8",
    );
    const memory = new FailureMemory(file);
    expect(memory.get("bad")).toBeUndefined();
    expect(memory.get("good")).toBe("mid");
  });
});
