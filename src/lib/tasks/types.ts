/**
 * Task manager types: the persistent, streamable wrapper around one
 * router pipeline run. A task is created by the UI (or POST /api/tasks),
 * routed through the S2 router, and its RouterEvents are buffered for
 * live SSE streaming and appended to disk so restarts keep history.
 */

import type { PermissionProfile, ProviderId } from "../adapters";
import type {
  DecisionSource,
  RouteOutcome,
  RouteOverride,
  RouterEvent,
  TaskKind,
  Tier,
  UsageTotals,
} from "../router";

export const TASK_STATUSES = [
  "routing",
  "running",
  "verifying",
  "escalated",
  "done",
  "failed",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTerminalStatus(status: TaskStatus): boolean {
  return status === "done" || status === "failed";
}

export interface TaskInput {
  prompt: string;
  kind: TaskKind;
  /** Working directory for repo tasks; omitted for chat. */
  cwd?: string;
  override?: RouteOverride;
  /** Defaults to "read-only". */
  permissionProfile?: PermissionProfile;
}

/** The model badge, denormalized onto the task for list rendering. */
export interface TaskDecisionSummary {
  tier: Tier;
  provider: ProviderId;
  model: string;
  decidedBy: DecisionSource;
  reason: string;
}

export interface TaskResultSummary {
  outcome: RouteOutcome;
  finalTier: Tier;
  finalProvider: ProviderId;
  finalModel: string;
  /** One-line reason for the final model (the badge tooltip). */
  reason: string;
  resultText: string;
  escalated: boolean;
  failovers: number;
  sessionId?: string;
  usage: UsageTotals;
  durationMs: number;
}

export interface TaskRecord {
  v: 1;
  id: string;
  /** First line of the prompt, capped — the card title. */
  title: string;
  prompt: string;
  kind: TaskKind;
  cwd?: string;
  override?: RouteOverride;
  permissionProfile: PermissionProfile;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  /** Present once the router has decided (the model badge). */
  decision?: TaskDecisionSummary;
  /** Present once the pipeline finished. */
  result?: TaskResultSummary;
  /** Infra failure detail when the pipeline itself broke. */
  error?: string;
}

/** Latest known subscription-window heartbeat per provider. */
export interface PlanWindow {
  provider: ProviderId;
  status: string;
  resetsAt?: string;
  windowType?: string;
  observedAt: string;
}

/** What the per-task SSE stream carries. */
export type TaskStreamEvent =
  | { type: "task"; task: TaskRecord }
  | { type: "router"; event: RouterEvent };
