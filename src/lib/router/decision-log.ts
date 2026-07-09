import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { ProviderId } from "../adapters";
import type {
  AttemptRecord,
  ClassifierVerdict,
  ConsultedLayer,
  DecisionSource,
  EscalationRecord,
  FailoverRecord,
  RouteOutcome,
  TaskKind,
  Tier,
  UsageTotals,
} from "./types";

/**
 * One line per routing decision, append-only JSONL in the gitignored
 * data dir. This is the misroute-review fuel: a week of "which model got
 * which task, and would a cheaper one have done" beats blind rubric
 * tuning. S3's telemetry screen reads this file directly, so the shape
 * is versioned (`v`) and flat enough to render as a table row.
 */
export interface DecisionRecord {
  v: 1;
  /** ISO timestamp of when the routing decision was made. */
  ts: string;
  /** Unique id for this routing (one per record). */
  taskId: string;
  /** Sticky-memory fingerprint; groups re-runs of the same task. */
  fingerprint: string;
  kind: TaskKind;
  promptChars: number;
  /** Layers consulted, in order (e.g. ["override"] or ["rules","classifier"]). */
  layers: ConsultedLayer[];
  decidedBy: DecisionSource;
  /** The one-line human-readable routing reason (the model badge text). */
  reason: string;
  /** The initial decision. */
  tier: Tier;
  provider: ProviderId;
  model: string;
  /** Present only when Layer 2 ran. */
  classifier?: ClassifierVerdict;
  /** Where the task actually ended up after failover / escalation. */
  final: { tier: Tier; provider: ProviderId; model: string };
  attempts: AttemptRecord[];
  failovers: FailoverRecord[];
  escalation: EscalationRecord | null;
  outcome: RouteOutcome;
  sessionId?: string;
  usage: UsageTotals;
  durationMs: number;
}

export class DecisionLog {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  append(record: DecisionRecord): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
}
