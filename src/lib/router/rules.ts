import type { RulesConfig } from "./config";
import { maxTier, tierRank, type RouteRequest, type Tier } from "./types";

/**
 * Layer 1: hard rules in code. Deterministic, testable as a table, and
 * they run before any LLM is consulted.
 *
 * Rules either decide the tier outright or declare the task ambiguous
 * with a floor tier; only ambiguous tasks reach the Layer 2 classifier.
 */
export type RulesVerdict =
  | { kind: "decided"; tier: Tier; source: "rules" | "memory"; reason: string }
  | { kind: "ambiguous"; floor: Tier; reason: string };

function findFrontierKeyword(
  prompt: string,
  keywords: string[],
): string | undefined {
  const haystack = prompt.toLowerCase();
  for (const keyword of keywords) {
    const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(haystack)) return keyword;
  }
  return undefined;
}

export function applyRules(
  request: Pick<RouteRequest, "prompt" | "kind">,
  config: RulesConfig,
  memoryTier?: Tier,
): RulesVerdict {
  const promptChars = request.prompt.length;

  let verdict: RulesVerdict;

  const keyword = findFrontierKeyword(request.prompt, config.frontierKeywords);
  if (keyword !== undefined) {
    verdict = {
      kind: "decided",
      tier: "frontier",
      source: "rules",
      reason: `hard rule: planning keyword "${keyword}" routes to frontier`,
    };
  } else if (promptChars >= config.frontierPromptChars) {
    verdict = {
      kind: "decided",
      tier: "frontier",
      source: "rules",
      reason: `hard rule: prompt of ${promptChars} chars needs a frontier context`,
    };
  } else if (request.kind === "chat") {
    verdict =
      promptChars >= config.midPromptChars
        ? {
            kind: "decided",
            tier: "mid",
            source: "rules",
            reason: `hard rule: chat with a ${promptChars}-char prompt is no quick question`,
          }
        : {
            kind: "decided",
            tier: "cheap",
            source: "rules",
            reason: "hard rule: quick chat question routes cheap",
          };
  } else {
    // Agentic repo task: at least mid, but whether it needs frontier is
    // the ambiguous middle the classifier exists for.
    verdict = {
      kind: "ambiguous",
      floor: "mid",
      reason: "agentic repo task starts at mid; classifier refines",
    };
  }

  if (memoryTier === undefined) return verdict;

  // Sticky failure memory: a fingerprint that previously escalated starts
  // at the higher tier. It can raise a decision or a floor, never lower it.
  if (verdict.kind === "decided") {
    if (tierRank(memoryTier) > tierRank(verdict.tier)) {
      return {
        kind: "decided",
        tier: memoryTier,
        source: "memory",
        reason: `sticky failure memory: this task previously escalated to ${memoryTier}`,
      };
    }
    return verdict;
  }
  if (tierRank(memoryTier) > tierRank(verdict.floor)) {
    // Memory outranks the classifier's whole range: decide directly.
    return {
      kind: "decided",
      tier: memoryTier,
      source: "memory",
      reason: `sticky failure memory: this task previously escalated to ${memoryTier}`,
    };
  }
  return {
    kind: "ambiguous",
    floor: maxTier(verdict.floor, memoryTier),
    reason: verdict.reason,
  };
}
