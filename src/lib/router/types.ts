/**
 * Router types: the difficulty-routing pipeline that decides which tier
 * (cheap / mid / frontier), provider, and model a task gets.
 *
 * Layering (each layer only runs if the previous one did not decide):
 *   0. explicit user override — absolute, never overridden
 *   1. hard rules in code (task kind, keywords, prompt size, sticky memory)
 *   2. cheap LLM classifier for the ambiguous middle only
 *   3. dispatch through the adapter layer, with in-tier provider failover
 *   4. verifier-gated escalation, max one hop, sticky, never downgraded
 */

import type {
  NormalizedEvent,
  PermissionProfile,
  ProviderId,
} from "../adapters";

export const TIERS = ["cheap", "mid", "frontier"] as const;
export type Tier = (typeof TIERS)[number];

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}

export function maxTier(a: Tier, b: Tier): Tier {
  return tierRank(a) >= tierRank(b) ? a : b;
}

export function tierAbove(tier: Tier): Tier | undefined {
  return TIERS[tierRank(tier) + 1];
}

/** "chat" = quick question, no repo context. "task" = agentic repo task. */
export type TaskKind = "chat" | "task";

/** A concrete (provider, model) pair. */
export interface ModelRef {
  provider: ProviderId;
  model: string;
}

/** Layer 0. Any field present makes the override absolute for that axis. */
export interface RouteOverride {
  /** Pin the provider. Tier still comes from the later layers (or `tier`). */
  provider?: ProviderId;
  /** Pin the exact model. Disables failover and escalation for this task. */
  model?: string;
  /** Pin the tier. Failover and escalation still apply within/above it. */
  tier?: Tier;
}

export interface RouteRequest {
  prompt: string;
  kind: TaskKind;
  /** Working directory for repo tasks; also where verifier commands run. */
  cwd?: string;
  override?: RouteOverride;
  /** Defaults to "read-only" (see adapter layer). */
  permissionProfile?: PermissionProfile;
}

export type DecisionSource =
  | "override"
  | "memory"
  | "rules"
  | "classifier"
  | "default";

export type ConsultedLayer = "override" | "rules" | "classifier";

/** The classifier's strict JSON rubric output (Layer 2). */
export interface ClassifierOutput {
  tier: Tier;
  confidence: number;
  estimatedFiles: number;
  reason: string;
}

export type ClassifierVerdict =
  | { ok: true; output: ClassifierOutput; raw: string }
  | { ok: false; error: string; raw?: string };

/**
 * The routing decision. `model` and `reason` are the transparency
 * invariant: every routed task carries the chosen model and a one-line
 * human-readable reason (which layer decided and why). S3 renders these
 * as the model badge.
 */
export interface RouteDecision {
  tier: Tier;
  provider: ProviderId;
  model: string;
  decidedBy: DecisionSource;
  /** One line, human-readable: which layer decided and why. */
  reason: string;
  /** Layers consulted, in order. */
  layers: ConsultedLayer[];
  /** Stable fingerprint of the task, used by sticky failure memory. */
  fingerprint: string;
  classifier?: ClassifierVerdict;
  /** True when an explicit model override pins the exact model. */
  modelPinned: boolean;
}

export interface UsageTotals {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export type AttemptOutcome = "completed" | "error" | "rate_limited";

export interface AttemptRecord {
  tier: Tier;
  provider: ProviderId;
  model: string;
  outcome: AttemptOutcome;
  detail?: string;
  sessionId?: string;
}

export interface FailoverRecord {
  from: ModelRef;
  to: ModelRef;
  detail: string;
}

export interface EscalationRecord {
  fromTier: Tier;
  toTier: Tier;
  trigger: "verifier";
  verifier: string;
  detail: string;
}

export type RouteOutcome =
  | "completed" // finished; no verifier applied
  | "verified" // finished and all applicable verifiers passed
  | "verify_failed" // failed verification even after (or without) escalation
  | "error" // provider run failed for a non-rate-limit reason
  | "rate_limited"; // every provider in the tier was rate limited

export interface RouteResult {
  decision: RouteDecision;
  /** Where the task actually ended up after failover / escalation. */
  finalTier: Tier;
  finalProvider: ProviderId;
  finalModel: string;
  /**
   * One-line human-readable reason for the final model. Equals
   * `decision.reason` unless failover or escalation moved the task.
   */
  reason: string;
  outcome: RouteOutcome;
  resultText: string;
  sessionId?: string;
  escalated: boolean;
  attempts: AttemptRecord[];
  failovers: FailoverRecord[];
  escalation?: EscalationRecord;
  usage: UsageTotals;
  durationMs: number;
}

/** Streaming events from the router pipeline (S3 renders these live). */
export type RouterEvent =
  | { type: "decision"; decision: RouteDecision }
  | { type: "attempt_started"; tier: Tier; provider: ProviderId; model: string }
  | { type: "provider_event"; event: NormalizedEvent }
  | { type: "failover"; failover: FailoverRecord }
  | { type: "verifying"; verifier: string }
  | { type: "escalated"; escalation: EscalationRecord }
  | { type: "result"; result: RouteResult };

/** Layer 4: pluggable verification. v1 ships a shell-command verifier. */
export interface VerifierContext {
  request: RouteRequest;
  resultText: string;
  cwd: string;
}

export interface VerifierResult {
  passed: boolean;
  detail: string;
}

export interface Verifier {
  name: string;
  /** Whether this verifier applies to the request (e.g. skip for chat). */
  applies(request: RouteRequest): boolean;
  verify(ctx: VerifierContext): Promise<VerifierResult>;
}
