/**
 * Tier map configuration: which concrete (provider, model) pairs each
 * difficulty tier routes to, plus rule thresholds and classifier settings.
 *
 * The user-editable config lives at the repo root (`bandleader.config.ts`)
 * and is validated through `defineConfig`. v1 is plans-only: every model
 * here must be covered by a subscription plan. Metered models (usage
 * credits, API keys) are rejected outright.
 */

import type { ProviderId } from "../adapters";
import { TIERS, type ModelRef, type Tier } from "./types";

export interface TierConfig {
  /**
   * Preference-ordered (provider, model) pairs. Dispatch takes the first;
   * rate-limit failover walks down the list.
   */
  preference: ModelRef[];
}

export interface RulesConfig {
  /**
   * Word-boundary keywords that mark a planning / architecture task and
   * route it straight to frontier.
   */
  frontierKeywords: string[];
  /** Prompts at or above this many characters start at least at mid. */
  midPromptChars: number;
  /** Prompts at or above this many characters start at frontier. */
  frontierPromptChars: number;
}

export interface ClassifierConfig {
  provider: ProviderId;
  model: string;
  /** Verdicts below this confidence are discarded and mid is used. */
  minConfidence: number;
}

export interface BandleaderConfig {
  tiers: Record<Tier, TierConfig>;
  rules: RulesConfig;
  classifier: ClassifierConfig;
  /**
   * Shell commands that must all exit 0 for a repo task to count as
   * verified (Layer 4). Run in the task's cwd. Chat tasks skip them.
   */
  verifyCommands: string[];
  /**
   * Directory for router runtime data (decision log, failure memory).
   * Gitignored; relative paths resolve against process.cwd().
   */
  dataDir: string;
}

const KNOWN_PROVIDERS: readonly ProviderId[] = ["claude", "codex"];

/**
 * Model-name fragments that indicate metered (non-plan) usage. v1 is
 * plans-only, so these are configuration errors, not preferences.
 */
const METERED_MODEL_PATTERN = /fable/i;

function assertModelRef(ref: ModelRef, where: string): void {
  if (!KNOWN_PROVIDERS.includes(ref.provider)) {
    throw new Error(
      `bandleader.config: unknown provider "${ref.provider}" in ${where}`,
    );
  }
  if (typeof ref.model !== "string" || ref.model.trim() === "") {
    throw new Error(`bandleader.config: empty model in ${where}`);
  }
  if (METERED_MODEL_PATTERN.test(ref.model)) {
    throw new Error(
      `bandleader.config: "${ref.model}" in ${where} is a metered model; ` +
        `v1 is plans-only and never spends usage credits`,
    );
  }
}

/** Validate and return the config. Throws on any plans-only violation. */
export function defineConfig(config: BandleaderConfig): BandleaderConfig {
  for (const tier of TIERS) {
    const tierConfig = config.tiers[tier];
    if (!tierConfig || tierConfig.preference.length === 0) {
      throw new Error(
        `bandleader.config: tier "${tier}" needs at least one (provider, model) pair`,
      );
    }
    tierConfig.preference.forEach((ref, i) =>
      assertModelRef(ref, `tiers.${tier}.preference[${i}]`),
    );
  }

  assertModelRef(
    { provider: config.classifier.provider, model: config.classifier.model },
    "classifier",
  );
  if (
    config.classifier.minConfidence < 0 ||
    config.classifier.minConfidence > 1
  ) {
    throw new Error(
      "bandleader.config: classifier.minConfidence must be between 0 and 1",
    );
  }

  if (config.rules.midPromptChars >= config.rules.frontierPromptChars) {
    throw new Error(
      "bandleader.config: rules.midPromptChars must be below rules.frontierPromptChars",
    );
  }

  return config;
}
