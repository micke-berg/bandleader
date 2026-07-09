import { describe, expect, it } from "vitest";

import type { RulesConfig } from "./config";
import { applyRules } from "./rules";

const config: RulesConfig = {
  frontierKeywords: ["architecture", "plan", "system design"],
  midPromptChars: 100,
  frontierPromptChars: 500,
};

describe("applyRules", () => {
  it("routes a quick chat question cheap", () => {
    const verdict = applyRules({ prompt: "What does .gitignore do?", kind: "chat" }, config);
    expect(verdict).toMatchObject({ kind: "decided", tier: "cheap", source: "rules" });
  });

  it("routes a long chat prompt to mid", () => {
    const verdict = applyRules({ prompt: "x".repeat(150), kind: "chat" }, config);
    expect(verdict).toMatchObject({ kind: "decided", tier: "mid" });
  });

  it("routes planning keywords to frontier for chat and task alike", () => {
    for (const kind of ["chat", "task"] as const) {
      const verdict = applyRules(
        { prompt: "Sketch the architecture for the sync service", kind },
        config,
      );
      expect(verdict).toMatchObject({ kind: "decided", tier: "frontier" });
    }
  });

  it("matches keywords on word boundaries only", () => {
    const verdict = applyRules(
      { prompt: "Rename the planet variable", kind: "chat" },
      config,
    );
    expect(verdict).toMatchObject({ kind: "decided", tier: "cheap" });
  });

  it("matches multi-word keywords", () => {
    const verdict = applyRules(
      { prompt: "We need a system design for uploads", kind: "chat" },
      config,
    );
    expect(verdict).toMatchObject({ kind: "decided", tier: "frontier" });
  });

  it("routes huge prompts to frontier regardless of kind", () => {
    const verdict = applyRules({ prompt: "y".repeat(600), kind: "chat" }, config);
    expect(verdict).toMatchObject({ kind: "decided", tier: "frontier" });
  });

  it("declares an ordinary repo task ambiguous with a mid floor", () => {
    const verdict = applyRules(
      { prompt: "Fix the typo in the readme", kind: "task" },
      config,
    );
    expect(verdict).toMatchObject({ kind: "ambiguous", floor: "mid" });
  });

  it("lets sticky memory raise an ambiguous task straight to frontier", () => {
    const verdict = applyRules(
      { prompt: "Fix the flaky test", kind: "task" },
      config,
      "frontier",
    );
    expect(verdict).toMatchObject({
      kind: "decided",
      tier: "frontier",
      source: "memory",
    });
  });

  it("keeps a task ambiguous when memory only confirms the mid floor", () => {
    const verdict = applyRules(
      { prompt: "Fix the flaky test", kind: "task" },
      config,
      "mid",
    );
    expect(verdict).toMatchObject({ kind: "ambiguous", floor: "mid" });
  });

  it("lets sticky memory raise a decided cheap chat", () => {
    const verdict = applyRules(
      { prompt: "Why does this fail?", kind: "chat" },
      config,
      "mid",
    );
    expect(verdict).toMatchObject({
      kind: "decided",
      tier: "mid",
      source: "memory",
    });
  });

  it("never lets memory lower a decided tier", () => {
    const verdict = applyRules(
      { prompt: "Sketch the architecture", kind: "task" },
      config,
      "cheap",
    );
    expect(verdict).toMatchObject({ kind: "decided", tier: "frontier" });
  });
});
