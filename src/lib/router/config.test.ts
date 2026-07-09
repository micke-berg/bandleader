import { describe, expect, it } from "vitest";

import { defineConfig, type BandleaderConfig } from "./config";

function validConfig(): BandleaderConfig {
  return {
    tiers: {
      cheap: { preference: [{ provider: "claude", model: "haiku" }] },
      mid: { preference: [{ provider: "claude", model: "sonnet" }] },
      frontier: { preference: [{ provider: "claude", model: "opus" }] },
    },
    rules: {
      frontierKeywords: ["architecture"],
      midPromptChars: 4_000,
      frontierPromptChars: 60_000,
    },
    classifier: { provider: "claude", model: "haiku", minConfidence: 0.6 },
    verifyCommands: [],
    dataDir: "data",
  };
}

describe("defineConfig", () => {
  it("accepts a valid plans-only config", () => {
    expect(defineConfig(validConfig())).toBeDefined();
  });

  it("rejects a tier with no (provider, model) pairs", () => {
    const config = validConfig();
    config.tiers.mid.preference = [];
    expect(() => defineConfig(config)).toThrow(/tier "mid"/);
  });

  it("rejects unknown providers", () => {
    const config = validConfig();
    config.tiers.cheap.preference = [
      { provider: "gemini" as never, model: "flash" },
    ];
    expect(() => defineConfig(config)).toThrow(/unknown provider/);
  });

  it("rejects metered models anywhere in the tier map (plans-only)", () => {
    const config = validConfig();
    config.tiers.frontier.preference.push({
      provider: "claude",
      model: "fable-5",
    });
    expect(() => defineConfig(config)).toThrow(/plans-only/);
  });

  it("rejects a metered classifier model", () => {
    const config = validConfig();
    config.classifier.model = "claude-fable-5";
    expect(() => defineConfig(config)).toThrow(/plans-only/);
  });

  it("rejects a confidence threshold outside [0, 1]", () => {
    const config = validConfig();
    config.classifier.minConfidence = 1.5;
    expect(() => defineConfig(config)).toThrow(/minConfidence/);
  });

  it("rejects inverted prompt-size thresholds", () => {
    const config = validConfig();
    config.rules.midPromptChars = 100_000;
    expect(() => defineConfig(config)).toThrow(/midPromptChars/);
  });
});
