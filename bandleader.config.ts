/**
 * Bandleader tier map. Edit this file to change which models each
 * difficulty tier routes to.
 *
 * v1 is plans-only: every model here rides an existing subscription plan
 * (Claude Max via the `claude` CLI, ChatGPT via the `codex` CLI). Metered
 * models are rejected by `defineConfig`.
 *
 * Model strings were verified against the real CLIs on 2026-07-10:
 * - `claude -p --model haiku|sonnet|opus` — aliases accepted, resolve to
 *   the current plan-covered versions (haiku 4.5 / sonnet 5 / opus 4.8).
 * - `codex exec --model gpt-5.6-terra` — accepted on a ChatGPT login.
 * - `codex exec --model gpt-5.6-sol` (and `gpt-5.6`) — rejected by the
 *   server: "not supported when using Codex with a ChatGPT account".
 *   Sol is therefore not addressable on the plan, so the frontier tier
 *   falls back to Codex's plan default (Terra) rather than Sol.
 */

import { defineConfig } from "./src/lib/router/config";

export default defineConfig({
  tiers: {
    cheap: {
      preference: [
        { provider: "claude", model: "haiku" },
        // Overqualified for the tier, but plan-covered: better to answer a
        // cheap question with Terra than to stall on a Claude rate limit.
        { provider: "codex", model: "gpt-5.6-terra" },
      ],
    },
    mid: {
      preference: [
        { provider: "claude", model: "sonnet" },
        { provider: "codex", model: "gpt-5.6-terra" },
      ],
    },
    frontier: {
      preference: [
        { provider: "claude", model: "opus" },
        // GPT-5.6 Sol is not addressable on a ChatGPT plan login (verified
        // 2026-07-10), so the frontier fallback is the Codex plan default.
        { provider: "codex", model: "gpt-5.6-terra" },
      ],
    },
  },

  rules: {
    // Word-boundary matched; any hit routes straight to frontier.
    frontierKeywords: [
      "architecture",
      "architect",
      "system design",
      "design doc",
      "adr",
      "rfc",
      "roadmap",
      "migration plan",
      "implementation plan",
      "plan",
      "trade-offs",
      "tradeoffs",
      "refactor across",
    ],
    // ~1k tokens: a chat question this long is no longer a quick question.
    midPromptChars: 4_000,
    // ~15k tokens of pasted context deserves a frontier model.
    frontierPromptChars: 60_000,
  },

  classifier: {
    // The classifier itself rides the plan: it runs through the Claude
    // adapter (the official CLI) on Haiku.
    provider: "claude",
    model: "haiku",
    minConfidence: 0.6,
  },

  // Layer 4 ground truth for repo tasks, run in the task's cwd.
  // Chat tasks and tasks without a cwd skip verification.
  verifyCommands: ["npm run typecheck"],

  dataDir: "data",
});
