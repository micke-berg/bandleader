/**
 * Live router smoke: routes three tiny real tasks end to end on your
 * real CLI logins and prints each routing decision plus the decision-log
 * lines it produced.
 *
 * Usage:
 *   npm run smoke:router
 *
 * Uses a small amount of plan quota (one Haiku chat, one Haiku classifier
 * ride + one Sonnet task, one Codex Terra task).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import config from "../bandleader.config";
import { routeTask } from "../src/lib/router";
import type { RouteRequest, RouteResult, Tier } from "../src/lib/router";

interface SmokeCase {
  label: string;
  request: RouteRequest;
  expect: {
    decidedBy: string;
    tier?: Tier;
    provider?: string;
    model?: string;
  };
}

const cases: SmokeCase[] = [
  {
    label: "quick chat question",
    request: { prompt: "What is 2+2? Reply with just the number.", kind: "chat" },
    expect: { tier: "cheap", decidedBy: "rules" },
  },
  {
    label: "normal small task",
    request: {
      prompt: "In one short sentence, say what a .gitignore file does.",
      kind: "task",
      // No cwd: the shell verifier does not apply, so this exercises
      // rules -> classifier -> dispatch without spending quota on checks.
    },
    expect: { tier: "mid", decidedBy: "classifier" },
  },
  {
    label: "explicit override",
    request: {
      prompt: "Reply with exactly: ok",
      kind: "chat",
      override: { provider: "codex", model: "gpt-5.6-terra" },
    },
    // A pinned model is absolute: the meaningful assertion is that the
    // exact (provider, model) pair was used, not which tier label it got.
    expect: { decidedBy: "override", provider: "codex", model: "gpt-5.6-terra" },
  },
];

function describeResult(label: string, result: RouteResult): void {
  console.log(`\n=== ${label} ===`);
  console.log(`decision : ${result.decision.tier} -> ${result.decision.provider}/${result.decision.model}`);
  console.log(`decidedBy: ${result.decision.decidedBy} (layers: ${result.decision.layers.join(" -> ")})`);
  console.log(`reason   : ${result.reason}`);
  console.log(`final    : ${result.finalTier} -> ${result.finalProvider}/${result.finalModel}`);
  console.log(`outcome  : ${result.outcome} in ${result.durationMs}ms`);
  console.log(`result   : ${JSON.stringify(result.resultText.slice(0, 200))}`);
}

async function main() {
  let failures = 0;
  const logPath = path.join(path.resolve(config.dataDir), "decisions.jsonl");

  for (const smokeCase of cases) {
    const result = await routeTask(smokeCase.request, { config });
    describeResult(smokeCase.label, result);

    const expected = smokeCase.expect;
    const checks: Array<[string, boolean]> = [
      [
        `decidedBy is ${expected.decidedBy}`,
        result.decision.decidedBy === expected.decidedBy,
      ],
      ["run finished", result.outcome === "completed" || result.outcome === "verified"],
      ["reason is one line", !result.reason.includes("\n") && result.reason.length > 0],
    ];
    if (expected.tier !== undefined) {
      checks.push([`tier is ${expected.tier}`, result.decision.tier === expected.tier]);
    }
    if (expected.provider !== undefined) {
      checks.push([
        `provider is ${expected.provider}`,
        result.finalProvider === expected.provider,
      ]);
    }
    if (expected.model !== undefined) {
      checks.push([`model is ${expected.model}`, result.finalModel === expected.model]);
    }
    for (const [name, passed] of checks) {
      console.log(`${passed ? "PASS" : "FAIL"}: ${name}`);
      if (!passed) failures++;
    }
  }

  console.log(`\n=== decision log (${logPath}) ===`);
  const lines = readFileSync(logPath, "utf8").trim().split("\n");
  for (const line of lines.slice(-cases.length)) {
    console.log(line);
  }

  if (failures > 0) {
    console.error(`\n[smoke:router] ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\n[smoke:router] all checks passed");
}

main().catch((err: unknown) => {
  console.error(`[smoke:router] fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
