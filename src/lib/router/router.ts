import { randomUUID } from "node:crypto";
import path from "node:path";

import { adapters as defaultAdapters } from "../adapters";
import type { Adapter, ProviderId } from "../adapters";
import { classify } from "./classifier";
import type { BandleaderConfig } from "./config";
import { DecisionLog } from "./decision-log";
import { fingerprintTask } from "./fingerprint";
import { FailureMemory } from "./memory";
import { applyRules } from "./rules";
import {
  TIERS,
  maxTier,
  tierAbove,
  tierRank,
  type AttemptOutcome,
  type AttemptRecord,
  type ClassifierVerdict,
  type ConsultedLayer,
  type DecisionSource,
  type EscalationRecord,
  type FailoverRecord,
  type ModelRef,
  type RouteDecision,
  type RouteOutcome,
  type RouteRequest,
  type RouteResult,
  type RouterEvent,
  type Tier,
  type UsageTotals,
  type Verifier,
} from "./types";
import { ShellVerifier } from "./verifier";

/**
 * The router pipeline. `decide` runs layers 0–2 and returns the routing
 * decision; `route` runs the full pipeline including dispatch (Layer 3,
 * with in-tier rate-limit failover) and verifier-gated escalation
 * (Layer 4, max one hop, sticky, never downgraded).
 */

export interface RouterDeps {
  config: BandleaderConfig;
  /** Injectable for tests; defaults to the real CLI adapters. */
  adapters?: Record<ProviderId, Adapter>;
  /** Defaults to a ShellVerifier over config.verifyCommands. */
  verifiers?: Verifier[];
  memory?: FailureMemory;
  log?: DecisionLog;
  now?: () => Date;
  id?: () => string;
}

interface ResolvedDeps {
  config: BandleaderConfig;
  adapters: Record<ProviderId, Adapter>;
  verifiers: Verifier[];
  memory: FailureMemory;
  log: DecisionLog;
  now: () => Date;
  id: () => string;
}

function resolveDeps(deps: RouterDeps): ResolvedDeps {
  const dataDir = path.resolve(deps.config.dataDir);
  return {
    config: deps.config,
    adapters: deps.adapters ?? defaultAdapters,
    verifiers: deps.verifiers ?? [new ShellVerifier(deps.config.verifyCommands)],
    memory:
      deps.memory ?? new FailureMemory(path.join(dataDir, "failure-memory.json")),
    log: deps.log ?? new DecisionLog(path.join(dataDir, "decisions.jsonl")),
    now: deps.now ?? (() => new Date()),
    id: deps.id ?? randomUUID,
  };
}

function inferProviderForModel(
  model: string,
  adapters: Record<ProviderId, Adapter>,
): ProviderId | undefined {
  for (const adapter of Object.values(adapters)) {
    if (adapter.models.includes(model)) return adapter.id;
  }
  return undefined;
}

function tierContaining(
  config: BandleaderConfig,
  ref: ModelRef,
): Tier | undefined {
  for (const tier of TIERS) {
    if (
      config.tiers[tier].preference.some(
        (p) => p.provider === ref.provider && p.model === ref.model,
      )
    ) {
      return tier;
    }
  }
  return undefined;
}

function primaryForTier(config: BandleaderConfig, tier: Tier): ModelRef {
  const primary = config.tiers[tier].preference[0];
  if (primary === undefined) {
    // defineConfig guarantees non-empty preferences; this guards raw configs.
    throw new Error(`tier "${tier}" has no (provider, model) pairs configured`);
  }
  return primary;
}

interface TierChoice {
  tier: Tier;
  source: DecisionSource;
  reason: string;
  classifier?: ClassifierVerdict;
}

/** Layers 1–2: hard rules, then the classifier for the ambiguous middle. */
async function chooseTier(
  request: RouteRequest,
  fingerprint: string,
  deps: ResolvedDeps,
  layers: ConsultedLayer[],
): Promise<TierChoice> {
  const { config, adapters, memory } = deps;
  const memoryTier = memory.get(fingerprint);

  layers.push("rules");
  const verdict = applyRules(request, config.rules, memoryTier);
  if (verdict.kind === "decided") {
    return { tier: verdict.tier, source: verdict.source, reason: verdict.reason };
  }

  layers.push("classifier");
  const classifierVerdict = await classify(request, config.classifier, adapters);

  if (!classifierVerdict.ok) {
    return {
      tier: maxTier("mid", verdict.floor),
      source: "default",
      reason: `classifier unusable (${classifierVerdict.error}); defaulting to mid`,
      classifier: classifierVerdict,
    };
  }
  const { output } = classifierVerdict;
  if (output.confidence < config.classifier.minConfidence) {
    return {
      tier: maxTier("mid", verdict.floor),
      source: "default",
      reason:
        `classifier confidence ${output.confidence.toFixed(2)} below ` +
        `${config.classifier.minConfidence}; defaulting to mid`,
      classifier: classifierVerdict,
    };
  }
  const tier = maxTier(output.tier, verdict.floor);
  const clampNote =
    tierRank(tier) > tierRank(output.tier)
      ? ` (raised to ${tier}: ${verdict.reason})`
      : "";
  return {
    tier,
    source: "classifier",
    reason: `classifier: ${output.reason} (confidence ${output.confidence.toFixed(2)})${clampNote}`,
    classifier: classifierVerdict,
  };
}

/** Layers 0–2: produce the routing decision without dispatching. */
export async function decide(
  request: RouteRequest,
  rawDeps: RouterDeps,
): Promise<RouteDecision> {
  const deps = resolveDeps(rawDeps);
  const { config, adapters } = deps;
  const fingerprint = fingerprintTask(request);
  const layers: ConsultedLayer[] = [];
  const override = request.override;

  // Layer 0: explicit model — absolute, disables failover and escalation.
  if (override?.model !== undefined) {
    layers.push("override");
    const provider =
      override.provider ?? inferProviderForModel(override.model, adapters);
    if (provider === undefined) {
      throw new Error(
        `override model "${override.model}" does not belong to a known ` +
          `provider; pass override.provider as well`,
      );
    }
    const ref: ModelRef = { provider, model: override.model };
    return {
      tier: tierContaining(config, ref) ?? override.tier ?? "mid",
      provider,
      model: override.model,
      decidedBy: "override",
      reason: `override: user pinned ${provider}/${override.model}`,
      layers,
      fingerprint,
      modelPinned: true,
    };
  }

  // Layer 0: explicit tier (optionally with a provider).
  if (override?.tier !== undefined) {
    layers.push("override");
    const tier = override.tier;
    const ref =
      override.provider !== undefined
        ? (config.tiers[tier].preference.find(
            (p) => p.provider === override.provider,
          ) ?? primaryForTier(config, tier))
        : primaryForTier(config, tier);
    return {
      tier,
      provider: ref.provider,
      model: ref.model,
      decidedBy: "override",
      reason:
        `override: user pinned tier ${tier}` +
        (override.provider !== undefined
          ? ` on provider ${override.provider}`
          : ""),
      layers,
      fingerprint,
      modelPinned: false,
    };
  }

  // Layer 0: explicit provider only — provider is pinned, the tier still
  // comes from the normal layers.
  if (override?.provider !== undefined) {
    layers.push("override");
    const choice = await chooseTier(request, fingerprint, deps, layers);
    const pinned = override.provider;
    const ref =
      config.tiers[choice.tier].preference.find((p) => p.provider === pinned) ??
      (adapters[pinned].models[0] !== undefined
        ? { provider: pinned, model: adapters[pinned].models[0] }
        : undefined);
    if (ref === undefined) {
      throw new Error(
        `override provider "${pinned}" has no model configured for tier "${choice.tier}"`,
      );
    }
    return {
      tier: choice.tier,
      provider: ref.provider,
      model: ref.model,
      decidedBy: "override",
      reason: `override: user pinned provider ${pinned}; ${choice.reason}`,
      layers,
      fingerprint,
      classifier: choice.classifier,
      modelPinned: false,
    };
  }

  // Layers 1–2.
  const choice = await chooseTier(request, fingerprint, deps, layers);
  const ref = primaryForTier(config, choice.tier);
  return {
    tier: choice.tier,
    provider: ref.provider,
    model: ref.model,
    decidedBy: choice.source,
    reason: choice.reason,
    layers,
    fingerprint,
    classifier: choice.classifier,
    modelPinned: false,
  };
}

const RATE_LIMIT_PATTERN =
  /rate.?limit|too many requests|overloaded|usage limit|429|529/i;

interface AttemptSummary {
  outcome: AttemptOutcome;
  resultText: string;
  sessionId?: string;
  detail?: string;
  usage: UsageTotals;
}

/** Layer 3: run one attempt through an adapter, forwarding its events. */
async function* runAttempt(
  ref: ModelRef,
  prompt: string,
  request: RouteRequest,
  adapters: Record<ProviderId, Adapter>,
): AsyncGenerator<RouterEvent, AttemptSummary> {
  const usage: UsageTotals = {};
  let resultText = "";
  let sessionId: string | undefined;
  let completed = false;
  let rateLimited = false;
  let errorDetail: string | undefined;

  try {
    for await (const event of adapters[ref.provider].run({
      prompt,
      model: ref.model,
      cwd: request.cwd,
      permissionProfile: request.permissionProfile,
    })) {
      yield { type: "provider_event", event };
      switch (event.type) {
        case "completed":
          completed = true;
          resultText = event.resultText;
          sessionId = event.sessionId;
          break;
        case "rate_limited":
          rateLimited = true;
          errorDetail = event.detail;
          break;
        case "error":
          errorDetail = event.detail;
          break;
        case "usage":
          usage.inputTokens = (usage.inputTokens ?? 0) + (event.inputTokens ?? 0);
          usage.outputTokens =
            (usage.outputTokens ?? 0) + (event.outputTokens ?? 0);
          if (event.costUsd !== undefined)
            usage.costUsd = (usage.costUsd ?? 0) + event.costUsd;
          break;
        default:
          break;
      }
    }
  } catch (err) {
    errorDetail = err instanceof Error ? err.message : String(err);
  }

  // A completed run wins even if a rate-limit heartbeat appeared mid-run:
  // the CLI recovered on its own. The rate-limit event shapes are only
  // synthetically tested (never observed live), so classify defensively:
  // an explicit rate_limited event, or an error that reads like one,
  // both count as rate limiting for failover purposes.
  const outcome: AttemptOutcome = completed
    ? "completed"
    : rateLimited ||
        (errorDetail !== undefined && RATE_LIMIT_PATTERN.test(errorDetail))
      ? "rate_limited"
      : "error";
  return {
    outcome,
    resultText,
    sessionId,
    detail: errorDetail ?? (completed ? undefined : "run produced no result"),
    usage,
  };
}

const HINT_RESULT_CAP = 2_000;

function escalationPrompt(
  originalPrompt: string,
  verifierDetail: string,
  previousResult: string,
): string {
  const cappedResult =
    previousResult.length > HINT_RESULT_CAP
      ? `${previousResult.slice(0, HINT_RESULT_CAP)}\n[truncated]`
      : previousResult;
  return (
    `${originalPrompt}\n\n---\n` +
    `A previous attempt by a smaller model failed verification. ` +
    `Do not repeat its mistake.\n` +
    `Verifier output:\n${verifierDetail}\n` +
    (cappedResult.trim() !== ""
      ? `Previous attempt's final answer (reference only, may be wrong):\n${cappedResult}\n`
      : "")
  );
}

function addUsage(total: UsageTotals, part: UsageTotals): void {
  if (part.inputTokens !== undefined)
    total.inputTokens = (total.inputTokens ?? 0) + part.inputTokens;
  if (part.outputTokens !== undefined)
    total.outputTokens = (total.outputTokens ?? 0) + part.outputTokens;
  if (part.costUsd !== undefined)
    total.costUsd = (total.costUsd ?? 0) + part.costUsd;
}

/**
 * The full pipeline as a stream of RouterEvents. The final event is
 * always `{ type: "result", result }`, and every routing (including
 * failures) appends one record to the decision log.
 */
export async function* route(
  request: RouteRequest,
  rawDeps: RouterDeps,
): AsyncGenerator<RouterEvent, RouteResult> {
  const deps = resolveDeps(rawDeps);
  const { config, adapters, verifiers, memory, log, now, id } = deps;

  const startedAt = now();
  const decision = await decide(request, rawDeps);
  yield { type: "decision", decision };

  const attempts: AttemptRecord[] = [];
  const failovers: FailoverRecord[] = [];
  const usage: UsageTotals = {};
  let escalation: EscalationRecord | undefined;
  let outcome: RouteOutcome = "error";
  let resultText = "";
  let sessionId: string | undefined;
  let finalReason = decision.reason;
  let currentTier = decision.tier;
  let currentRef: ModelRef = { provider: decision.provider, model: decision.model };
  let currentPrompt = request.prompt;

  const candidatesForTier = (tier: Tier): ModelRef[] => {
    if (decision.modelPinned) {
      return [{ provider: decision.provider, model: decision.model }];
    }
    const preference = config.tiers[tier].preference;
    if (request.override?.provider !== undefined) {
      const pinned = preference.filter(
        (p) => p.provider === request.override?.provider,
      );
      return pinned.length > 0
        ? pinned
        : [{ provider: decision.provider, model: decision.model }];
    }
    return preference;
  };

  try {
    // At most two passes: the initial tier and one verifier-gated hop up.
    for (;;) {
      const candidates = candidatesForTier(currentTier);
      let attempt: AttemptSummary | undefined;

      // Layer 3: dispatch with in-tier rate-limit failover.
      for (let i = 0; i < candidates.length; i++) {
        const ref = candidates[i];
        if (ref === undefined) break;
        currentRef = ref;
        yield {
          type: "attempt_started",
          tier: currentTier,
          provider: ref.provider,
          model: ref.model,
        };
        attempt = yield* runAttempt(ref, currentPrompt, request, adapters);
        attempts.push({
          tier: currentTier,
          provider: ref.provider,
          model: ref.model,
          outcome: attempt.outcome,
          detail: attempt.detail,
          sessionId: attempt.sessionId,
        });
        addUsage(usage, attempt.usage);

        if (attempt.outcome === "completed") break;
        const next = candidates[i + 1];
        if (attempt.outcome === "rate_limited" && next !== undefined) {
          const failover: FailoverRecord = {
            from: ref,
            to: next,
            detail: attempt.detail ?? "rate limited",
          };
          failovers.push(failover);
          yield { type: "failover", failover };
          finalReason = `${decision.reason}; failed over to ${next.provider}/${next.model} after rate limit`;
          continue;
        }
        break;
      }

      if (attempt === undefined || attempt.outcome !== "completed") {
        outcome = attempt?.outcome === "rate_limited" ? "rate_limited" : "error";
        resultText = attempt?.detail ?? "no attempt could run";
        break;
      }

      resultText = attempt.resultText;
      sessionId = attempt.sessionId;

      // Layer 4: verifier-gated escalation.
      const applicable = verifiers.filter((v) => v.applies(request));
      if (applicable.length === 0) {
        outcome = "completed";
        break;
      }

      let failure: { verifier: string; detail: string } | undefined;
      for (const verifier of applicable) {
        yield { type: "verifying", verifier: verifier.name };
        const verdict = await verifier.verify({
          request,
          resultText,
          cwd: request.cwd ?? process.cwd(),
        });
        if (!verdict.passed) {
          failure = { verifier: verifier.name, detail: verdict.detail };
          break;
        }
      }

      if (failure === undefined) {
        outcome = "verified";
        break;
      }

      const toTier = tierAbove(currentTier);
      if (decision.modelPinned || escalation !== undefined || toTier === undefined) {
        // Max one hop, and a pinned model is never silently rerouted.
        // Sticky: remember that this task needed at least this tier.
        if (!decision.modelPinned) {
          memory.recordEscalation(decision.fingerprint, currentTier, now());
        }
        outcome = "verify_failed";
        finalReason = `${finalReason}; verification failed (${failure.verifier})`;
        break;
      }

      // Escalate: re-run the ORIGINAL prompt one tier up with the failed
      // attempt appended as a hint. Sticky — recorded before the re-run
      // so even an interrupted escalation starts higher next time.
      memory.recordEscalation(decision.fingerprint, toTier, now());
      escalation = {
        fromTier: currentTier,
        toTier,
        trigger: "verifier",
        verifier: failure.verifier,
        detail: failure.detail,
      };
      yield { type: "escalated", escalation };
      currentPrompt = escalationPrompt(request.prompt, failure.detail, resultText);
      currentTier = toTier;
      finalReason = `escalated ${escalation.fromTier}→${toTier} after ${failure.verifier} verification failed; originally: ${decision.reason}`;
    }
  } catch (err) {
    outcome = "error";
    resultText = err instanceof Error ? err.message : String(err);
  }

  const finishedAt = now();
  const result: RouteResult = {
    decision,
    finalTier: currentTier,
    finalProvider: currentRef.provider,
    finalModel: currentRef.model,
    reason: finalReason,
    outcome,
    resultText,
    sessionId,
    escalated: escalation !== undefined,
    attempts,
    failovers,
    escalation,
    usage,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };

  log.append({
    v: 1,
    ts: startedAt.toISOString(),
    taskId: id(),
    fingerprint: decision.fingerprint,
    kind: request.kind,
    promptChars: request.prompt.length,
    layers: decision.layers,
    decidedBy: decision.decidedBy,
    reason: result.reason,
    tier: decision.tier,
    provider: decision.provider,
    model: decision.model,
    classifier: decision.classifier,
    final: {
      tier: result.finalTier,
      provider: result.finalProvider,
      model: result.finalModel,
    },
    attempts,
    failovers,
    escalation: escalation ?? null,
    outcome,
    sessionId,
    usage,
    durationMs: result.durationMs,
  });

  yield { type: "result", result };
  return result;
}

/** Drain the pipeline and return the final result. */
export async function routeTask(
  request: RouteRequest,
  deps: RouterDeps,
): Promise<RouteResult> {
  const iterator = route(request, deps);
  for (;;) {
    const step = await iterator.next();
    if (step.done === true) return step.value;
  }
}
