import { readFileSync } from "node:fs";

import type { DecisionRecord, Tier } from "../router";
import type { ProviderId } from "../adapters";

/**
 * Read side of the router's decision log (`data/decisions.jsonl`).
 * Tolerant by design: malformed or foreign-version lines are skipped,
 * never fatal — telemetry must render whatever history exists.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseDecisionLine(line: string): DecisionRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (
    isRecord(parsed) &&
    parsed.v === 1 &&
    typeof parsed.ts === "string" &&
    typeof parsed.taskId === "string" &&
    typeof parsed.model === "string" &&
    isRecord(parsed.final)
  ) {
    return parsed as unknown as DecisionRecord;
  }
  return undefined;
}

/** Newest first, capped at `limit`. Missing file → empty history. */
export function readDecisions(filePath: string, limit: number): DecisionRecord[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const records: DecisionRecord[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const record = parseDecisionLine(line);
    if (record !== undefined) records.push(record);
  }
  return records.reverse().slice(0, limit);
}

export interface TelemetryStats {
  total: number;
  byTier: Record<Tier, number>;
  byFinalProvider: Record<ProviderId, number>;
  escalations: number;
  failovers: number;
  verifyFailed: number;
  errors: number;
  /** Plan-equivalent cost as reported by the Claude CLI; Codex reports none. */
  totalCostUsd: number;
  classifierRuns: number;
}

export function aggregateDecisions(records: DecisionRecord[]): TelemetryStats {
  const stats: TelemetryStats = {
    total: records.length,
    byTier: { cheap: 0, mid: 0, frontier: 0 },
    byFinalProvider: { claude: 0, codex: 0 },
    escalations: 0,
    failovers: 0,
    verifyFailed: 0,
    errors: 0,
    totalCostUsd: 0,
    classifierRuns: 0,
  };
  for (const record of records) {
    stats.byTier[record.final.tier] += 1;
    stats.byFinalProvider[record.final.provider] += 1;
    if (record.escalation !== null) stats.escalations += 1;
    stats.failovers += record.failovers.length;
    if (record.outcome === "verify_failed") stats.verifyFailed += 1;
    if (record.outcome === "error" || record.outcome === "rate_limited")
      stats.errors += 1;
    stats.totalCostUsd += record.usage.costUsd ?? 0;
    if (record.layers.includes("classifier")) stats.classifierRuns += 1;
  }
  return stats;
}
