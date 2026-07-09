import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type {
  Adapter,
  NormalizedEvent,
  ProviderId,
  RunOptions,
} from "../adapters";
import type { BandleaderConfig } from "./config";
import { defineConfig } from "./config";
import type { DecisionRecord } from "./decision-log";
import { decide, route, routeTask, type RouterDeps } from "./router";
import {
  FakeAdapter,
  errorEvents,
  okEvents,
  rateLimitedEvents,
} from "./testing";
import type {
  RouteRequest,
  RouterEvent,
  Verifier,
  VerifierContext,
} from "./types";

const CLASSIFIER_MODEL = "fake-classifier";

function classifierJson(tier: string, confidence: number): string {
  return JSON.stringify({
    tier,
    confidence,
    estimated_files: 2,
    reason: "test verdict",
  });
}

function testConfig(dataDir: string): BandleaderConfig {
  return defineConfig({
    tiers: {
      cheap: {
        preference: [
          { provider: "claude", model: "fake-cheap" },
          { provider: "codex", model: "fake-cheap-2" },
        ],
      },
      mid: {
        preference: [
          { provider: "claude", model: "fake-mid" },
          { provider: "codex", model: "fake-mid-2" },
        ],
      },
      frontier: {
        preference: [
          { provider: "claude", model: "fake-frontier" },
          { provider: "codex", model: "fake-frontier-2" },
        ],
      },
    },
    rules: {
      frontierKeywords: ["architecture"],
      midPromptChars: 1_000,
      frontierPromptChars: 5_000,
    },
    classifier: { provider: "claude", model: CLASSIFIER_MODEL, minConfidence: 0.6 },
    verifyCommands: [],
    dataDir,
  });
}

const CLAUDE_MODELS = [
  "fake-cheap",
  "fake-mid",
  "fake-frontier",
  CLASSIFIER_MODEL,
];
const CODEX_MODELS = ["fake-cheap-2", "fake-mid-2", "fake-frontier-2"];

interface Setup {
  deps: RouterDeps;
  claude: FakeAdapter;
  codex: FakeAdapter;
  dataDir: string;
}

function setup(options: {
  classifierVerdict?: string;
  claudeTask?: (opts: RunOptions) => NormalizedEvent[];
  codexTask?: (opts: RunOptions) => NormalizedEvent[];
  verifiers?: Verifier[];
}): Setup {
  const dataDir = mkdtempSync(path.join(tmpdir(), "bandleader-router-"));
  const classifierVerdict =
    options.classifierVerdict ?? classifierJson("mid", 0.9);

  const claude = new FakeAdapter("claude", CLAUDE_MODELS, (opts) => {
    if (opts.model === CLASSIFIER_MODEL) {
      return okEvents("claude", classifierVerdict, "classifier-sess");
    }
    return options.claudeTask
      ? options.claudeTask(opts)
      : okEvents("claude", `claude ran ${opts.model ?? "default"}`);
  });
  const codex = new FakeAdapter("codex", CODEX_MODELS, (opts) =>
    options.codexTask
      ? options.codexTask(opts)
      : okEvents("codex", `codex ran ${opts.model ?? "default"}`),
  );

  const adapters: Record<ProviderId, Adapter> = { claude, codex };
  return {
    deps: {
      config: testConfig(dataDir),
      adapters,
      verifiers: options.verifiers ?? [],
    },
    claude,
    codex,
    dataDir,
  };
}

function classifierCalls(adapter: FakeAdapter): RunOptions[] {
  return adapter.calls.filter((c) => c.model === CLASSIFIER_MODEL);
}

function logRecords(dataDir: string): DecisionRecord[] {
  const file = path.join(path.resolve(dataDir), "decisions.jsonl");
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as DecisionRecord);
}

class FakeVerifier implements Verifier {
  readonly name = "fake";
  readonly seen: VerifierContext[] = [];
  private readonly failWhen: (ctx: VerifierContext) => boolean;

  constructor(failWhen: (ctx: VerifierContext) => boolean) {
    this.failWhen = failWhen;
  }

  applies(request: RouteRequest): boolean {
    return request.kind === "task";
  }

  async verify(ctx: VerifierContext) {
    this.seen.push(ctx);
    return this.failWhen(ctx)
      ? { passed: false, detail: "fake verifier failed" }
      : { passed: true, detail: "ok" };
  }
}

describe("decide", () => {
  it("routes chat cheap via rules without consulting the classifier", async () => {
    const { deps, claude } = setup({});
    const decision = await decide(
      { prompt: "What is a monad?", kind: "chat" },
      deps,
    );
    expect(decision).toMatchObject({
      tier: "cheap",
      provider: "claude",
      model: "fake-cheap",
      decidedBy: "rules",
      layers: ["rules"],
    });
    expect(classifierCalls(claude)).toHaveLength(0);
  });

  it("consults the classifier for an ambiguous repo task", async () => {
    const { deps, claude } = setup({
      classifierVerdict: classifierJson("mid", 0.9),
    });
    const decision = await decide(
      { prompt: "Rename the config loader", kind: "task" },
      deps,
    );
    expect(decision).toMatchObject({
      tier: "mid",
      model: "fake-mid",
      decidedBy: "classifier",
      layers: ["rules", "classifier"],
    });
    expect(classifierCalls(claude)).toHaveLength(1);
  });

  it("clamps a confident cheap verdict up to the task floor (mid)", async () => {
    const { deps } = setup({ classifierVerdict: classifierJson("cheap", 0.95) });
    const decision = await decide(
      { prompt: "Fix the readme typo", kind: "task" },
      deps,
    );
    expect(decision.tier).toBe("mid");
    expect(decision.reason).toContain("raised to mid");
  });

  it("follows a confident frontier verdict", async () => {
    const { deps } = setup({
      classifierVerdict: classifierJson("frontier", 0.8),
    });
    const decision = await decide(
      { prompt: "Untangle the circular imports", kind: "task" },
      deps,
    );
    expect(decision).toMatchObject({ tier: "frontier", model: "fake-frontier" });
  });

  it("defaults to mid when the classifier output is malformed", async () => {
    const { deps } = setup({ classifierVerdict: "definitely not json" });
    const decision = await decide(
      { prompt: "Rename the config loader", kind: "task" },
      deps,
    );
    expect(decision).toMatchObject({ tier: "mid", decidedBy: "default" });
    expect(decision.reason).toContain("classifier unusable");
  });

  it("defaults to mid when classifier confidence is below the threshold", async () => {
    const { deps } = setup({
      classifierVerdict: classifierJson("frontier", 0.4),
    });
    const decision = await decide(
      { prompt: "Rename the config loader", kind: "task" },
      deps,
    );
    expect(decision).toMatchObject({ tier: "mid", decidedBy: "default" });
    expect(decision.reason).toContain("confidence 0.40");
  });

  it("treats an explicit model override as absolute", async () => {
    const { deps, claude } = setup({});
    const decision = await decide(
      {
        prompt: "Design the architecture for everything",
        kind: "task",
        override: { model: "fake-cheap" },
      },
      deps,
    );
    expect(decision).toMatchObject({
      provider: "claude",
      model: "fake-cheap",
      decidedBy: "override",
      layers: ["override"],
      modelPinned: true,
    });
    expect(classifierCalls(claude)).toHaveLength(0);
  });

  it("infers the provider for an overridden model from adapter model lists", async () => {
    const { deps } = setup({});
    const decision = await decide(
      { prompt: "x", kind: "chat", override: { model: "fake-mid-2" } },
      deps,
    );
    expect(decision.provider).toBe("codex");
  });

  it("rejects an overridden model no provider knows", async () => {
    const { deps } = setup({});
    await expect(
      decide(
        { prompt: "x", kind: "chat", override: { model: "gpt-9-quasar" } },
        deps,
      ),
    ).rejects.toThrow(/override model/);
  });

  it("honors a tier override", async () => {
    const { deps, claude } = setup({});
    const decision = await decide(
      { prompt: "quick one", kind: "chat", override: { tier: "frontier" } },
      deps,
    );
    expect(decision).toMatchObject({
      tier: "frontier",
      model: "fake-frontier",
      decidedBy: "override",
      modelPinned: false,
    });
    expect(classifierCalls(claude)).toHaveLength(0);
  });

  it("pins the provider but still routes the tier for a provider override", async () => {
    const { deps } = setup({});
    const decision = await decide(
      { prompt: "What is a monad?", kind: "chat", override: { provider: "codex" } },
      deps,
    );
    expect(decision).toMatchObject({
      tier: "cheap",
      provider: "codex",
      model: "fake-cheap-2",
      decidedBy: "override",
    });
  });
});

describe("route: dispatch and failover", () => {
  it("completes a cheap chat and logs the decision", async () => {
    const { deps, dataDir } = setup({});
    const result = await routeTask(
      { prompt: "What is a monad?", kind: "chat" },
      deps,
    );
    expect(result).toMatchObject({
      outcome: "completed",
      finalProvider: "claude",
      finalModel: "fake-cheap",
      escalated: false,
    });
    expect(result.reason).not.toContain("\n");
    expect(result.resultText).toBe("claude ran fake-cheap");

    const records = logRecords(dataDir);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      v: 1,
      kind: "chat",
      decidedBy: "rules",
      tier: "cheap",
      outcome: "completed",
      final: { tier: "cheap", provider: "claude", model: "fake-cheap" },
    });
  });

  it("fails over to the next provider in the tier on rate limit", async () => {
    const { deps, dataDir } = setup({
      claudeTask: () => rateLimitedEvents("claude", "429 too many requests"),
    });
    const events: RouterEvent[] = [];
    let result;
    const iterator = route({ prompt: "hello there", kind: "chat" }, deps);
    for (;;) {
      const step = await iterator.next();
      if (step.done === true) {
        result = step.value;
        break;
      }
      events.push(step.value);
    }

    expect(result.outcome).toBe("completed");
    expect(result.finalProvider).toBe("codex");
    expect(result.finalModel).toBe("fake-cheap-2");
    expect(result.failovers).toHaveLength(1);
    expect(result.reason).toContain("failed over to codex/fake-cheap-2");
    expect(events.some((e) => e.type === "failover")).toBe(true);

    const record = logRecords(dataDir)[0];
    expect(record?.failovers).toHaveLength(1);
    expect(record?.attempts.map((a) => a.outcome)).toEqual([
      "rate_limited",
      "completed",
    ]);
  });

  it("reports rate_limited when every provider in the tier is throttled", async () => {
    const { deps } = setup({
      claudeTask: () => rateLimitedEvents("claude"),
      codexTask: () => rateLimitedEvents("codex"),
    });
    const result = await routeTask({ prompt: "hello", kind: "chat" }, deps);
    expect(result.outcome).toBe("rate_limited");
    expect(result.attempts).toHaveLength(2);
  });

  it("does not fail over on a non-rate-limit error", async () => {
    const { deps, codex } = setup({
      claudeTask: () => errorEvents("claude", "segfault in the parser"),
    });
    const result = await routeTask({ prompt: "hello", kind: "chat" }, deps);
    expect(result.outcome).toBe("error");
    expect(result.attempts).toHaveLength(1);
    expect(codex.calls).toHaveLength(0);
  });

  it("treats a rate-limit-looking error detail as rate limiting (defensive)", async () => {
    const { deps } = setup({
      // No explicit rate_limited event; only an error whose text reads
      // like a limit. The S1 event shapes are unconfirmed live, so the
      // router must catch this too.
      claudeTask: () => errorEvents("claude", "HTTP 429: usage limit reached"),
    });
    const result = await routeTask({ prompt: "hello", kind: "chat" }, deps);
    expect(result.outcome).toBe("completed");
    expect(result.finalProvider).toBe("codex");
  });
});

describe("route: verifier-gated escalation", () => {
  const taskRequest: RouteRequest = {
    prompt: "Make the tests pass",
    kind: "task",
    cwd: "/tmp/fake-repo",
  };

  function escalationSetup(options: { alwaysFail?: boolean } = {}) {
    const verifier = new FakeVerifier((ctx) =>
      options.alwaysFail === true
        ? true
        : !ctx.resultText.includes("fake-frontier"),
    );
    const base = setup({
      classifierVerdict: classifierJson("mid", 0.9),
      verifiers: [verifier],
    });
    return { ...base, verifier };
  }

  it("escalates one tier up with the failed attempt as a hint", async () => {
    const { deps, claude, dataDir } = escalationSetup();
    const result = await routeTask(taskRequest, deps);

    expect(result).toMatchObject({
      outcome: "verified",
      escalated: true,
      finalTier: "frontier",
      finalModel: "fake-frontier",
    });
    expect(result.escalation).toMatchObject({
      fromTier: "mid",
      toTier: "frontier",
      trigger: "verifier",
    });
    expect(result.reason).toContain("escalated mid→frontier");

    const taskCalls = claude.calls.filter((c) => c.model !== CLASSIFIER_MODEL);
    expect(taskCalls).toHaveLength(2);
    // The escalated run gets the ORIGINAL prompt plus the failure hint.
    expect(taskCalls[1]?.prompt).toContain("Make the tests pass");
    expect(taskCalls[1]?.prompt).toContain("failed verification");
    expect(taskCalls[1]?.prompt).toContain("fake verifier failed");

    const record = logRecords(dataDir)[0];
    expect(record?.escalation).toMatchObject({ fromTier: "mid", toTier: "frontier" });
    expect(record?.outcome).toBe("verified");
  });

  it("records the escalation in sticky memory so the rerun starts higher", async () => {
    const { deps } = escalationSetup();
    await routeTask(taskRequest, deps);

    // Same fingerprint, fresh routing: memory should decide frontier
    // without consulting the classifier again.
    const decision = await decide(taskRequest, deps);
    expect(decision).toMatchObject({ tier: "frontier", decidedBy: "memory" });
  });

  it("escalates at most one hop and then reports verify_failed", async () => {
    const { deps, verifier } = escalationSetup({ alwaysFail: true });
    const result = await routeTask(taskRequest, deps);

    expect(result.outcome).toBe("verify_failed");
    expect(result.escalated).toBe(true);
    expect(result.finalTier).toBe("frontier");
    // Verified twice (mid, then frontier), never a third time.
    expect(verifier.seen).toHaveLength(2);
  });

  it("never escalates past a pinned model override", async () => {
    const verifier = new FakeVerifier(() => true);
    const { deps } = setup({ verifiers: [verifier] });
    const result = await routeTask(
      { ...taskRequest, override: { model: "fake-mid" } },
      deps,
    );
    expect(result.outcome).toBe("verify_failed");
    expect(result.escalated).toBe(false);
    expect(result.finalModel).toBe("fake-mid");
    expect(result.attempts).toHaveLength(1);
  });

  it("skips verification entirely for chat", async () => {
    const verifier = new FakeVerifier(() => true);
    const { deps } = setup({ verifiers: [verifier] });
    const result = await routeTask({ prompt: "quick q", kind: "chat" }, deps);
    expect(result.outcome).toBe("completed");
    expect(verifier.seen).toHaveLength(0);
  });
});

describe("transparency invariant", () => {
  it("every result carries the chosen model and a one-line reason", async () => {
    const cases: RouteRequest[] = [
      { prompt: "quick q", kind: "chat" },
      { prompt: "do a task", kind: "task" },
      { prompt: "quick q", kind: "chat", override: { model: "fake-frontier" } },
    ];
    for (const request of cases) {
      const { deps } = setup({});
      const result = await routeTask(request, deps);
      expect(result.finalModel).not.toBe("");
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).not.toContain("\n");
      expect(result.decision.reason.length).toBeGreaterThan(0);
    }
  });
});
