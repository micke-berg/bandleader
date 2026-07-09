import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { RouteRequest } from "./types";
import { ShellVerifier } from "./verifier";

const taskRequest: RouteRequest = { prompt: "p", kind: "task", cwd: "/tmp" };

describe("ShellVerifier.applies", () => {
  it("applies to repo tasks with a cwd and configured commands", () => {
    expect(new ShellVerifier(["true"]).applies(taskRequest)).toBe(true);
  });

  it("skips chat", () => {
    expect(
      new ShellVerifier(["true"]).applies({ prompt: "p", kind: "chat" }),
    ).toBe(false);
  });

  it("skips tasks without a cwd", () => {
    expect(
      new ShellVerifier(["true"]).applies({ prompt: "p", kind: "task" }),
    ).toBe(false);
  });

  it("skips when no commands are configured", () => {
    expect(new ShellVerifier([]).applies(taskRequest)).toBe(false);
  });
});

describe("ShellVerifier.verify", () => {
  it("passes when every command exits 0", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bandleader-verify-"));
    const result = await new ShellVerifier(["true", "true"]).verify({
      request: taskRequest,
      resultText: "",
      cwd: dir,
    });
    expect(result.passed).toBe(true);
  });

  it("fails with the command output when a command exits non-zero", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bandleader-verify-"));
    const result = await new ShellVerifier(["echo boom >&2; exit 1"]).verify({
      request: taskRequest,
      resultText: "",
      cwd: dir,
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("boom");
  });

  it("stops at the first failing command", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bandleader-verify-"));
    const marker = path.join(dir, "ran-second");
    const result = await new ShellVerifier([
      "exit 1",
      `touch ${marker}`,
    ]).verify({ request: taskRequest, resultText: "", cwd: dir });
    expect(result.passed).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });
});
