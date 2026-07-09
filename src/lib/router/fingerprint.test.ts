import { describe, expect, it } from "vitest";

import { fingerprintTask } from "./fingerprint";

describe("fingerprintTask", () => {
  it("is a 16-char hex string", () => {
    expect(fingerprintTask({ prompt: "Fix it", kind: "task" })).toMatch(
      /^[0-9a-f]{16}$/,
    );
  });

  it("ignores case and whitespace differences in the prompt", () => {
    const a = fingerprintTask({ prompt: "Fix  the   Bug", kind: "task" });
    const b = fingerprintTask({ prompt: "fix the bug", kind: "task" });
    expect(a).toBe(b);
  });

  it("differs by kind", () => {
    const a = fingerprintTask({ prompt: "fix the bug", kind: "task" });
    const b = fingerprintTask({ prompt: "fix the bug", kind: "chat" });
    expect(a).not.toBe(b);
  });

  it("differs by cwd", () => {
    const a = fingerprintTask({ prompt: "fix the bug", kind: "task", cwd: "/a" });
    const b = fingerprintTask({ prompt: "fix the bug", kind: "task", cwd: "/b" });
    expect(a).not.toBe(b);
  });
});
