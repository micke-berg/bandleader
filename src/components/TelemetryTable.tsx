"use client";

import { useState } from "react";

import { setMisrouteFlag } from "@/lib/client/api";
import { formatCost, formatDateTime, formatDuration } from "@/lib/client/format";
import type { DecisionRecord } from "@/lib/router";
import type { MisrouteFlags } from "@/lib/telemetry/flags";
import { ModelBadge, TierChip } from "./badges";

/**
 * The decision log as a table: one row per routing, exactly the shape of
 * a `data/decisions.jsonl` line. The flag column is the misroute review —
 * a week of flags beats blind rubric tuning.
 */
export function TelemetryTable({
  decisions,
  flags: initialFlags,
}: {
  decisions: DecisionRecord[];
  flags: MisrouteFlags;
}) {
  const [flags, setFlags] = useState(initialFlags);
  const [busyId, setBusyId] = useState<string>();

  const toggle = async (record: DecisionRecord): Promise<void> => {
    const next = !(flags[record.taskId]?.flagged ?? false);
    setBusyId(record.taskId);
    try {
      const { flags: updated } = await setMisrouteFlag(record.taskId, next);
      setFlags(updated);
    } catch {
      // leave the previous state; the next telemetry load will resync
    } finally {
      setBusyId(undefined);
    }
  };

  if (decisions.length === 0) {
    return (
      <div className="empty-state">
        No routing decisions logged yet. Run a task or a chat message and the
        decision appears here.
      </div>
    );
  }

  return (
    <div className="panel table-wrap">
      <table className="telemetry-table">
        <thead>
          <tr>
            <th>when</th>
            <th>kind</th>
            <th>model</th>
            <th>tier</th>
            <th>decided by</th>
            <th>reason</th>
            <th>outcome</th>
            <th style={{ textAlign: "right" }}>took</th>
            <th style={{ textAlign: "right" }}>plan-eq</th>
            <th>review</th>
          </tr>
        </thead>
        <tbody>
          {decisions.map((record) => {
            const moved =
              record.final.tier !== record.tier ||
              record.final.provider !== record.provider ||
              record.final.model !== record.model;
            const flagged = flags[record.taskId]?.flagged ?? false;
            return (
              <tr key={record.taskId}>
                <td className="cell-time" title={record.ts}>
                  {formatDateTime(record.ts)}
                </td>
                <td>
                  <span className="task-kind-chip">{record.kind}</span>
                </td>
                <td>
                  <ModelBadge
                    provider={record.final.provider}
                    model={record.final.model}
                    title={record.reason}
                  />
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <TierChip tier={record.final.tier} />
                  {record.escalation !== null && (
                    <span className="escalation-mark" title={record.escalation.detail}>
                      {" "}
                      ↑{record.tier}
                    </span>
                  )}
                  {moved && record.escalation === null && (
                    <span className="escalation-mark" title="failed over from the primary choice">
                      {" "}
                      ⇄
                    </span>
                  )}
                </td>
                <td className="mono" style={{ fontSize: "var(--fs-micro)", whiteSpace: "nowrap" }}>
                  {record.decidedBy}
                </td>
                <td className="cell-reason">
                  <div title={record.reason}>{record.reason}</div>
                </td>
                <td className="cell-outcome">
                  <span className="outcome-chip" data-outcome={record.outcome}>
                    {record.outcome.replaceAll("_", " ")}
                  </span>
                </td>
                <td className="cell-cost">{formatDuration(record.durationMs)}</td>
                <td className="cell-cost">{formatCost(record.usage.costUsd)}</td>
                <td>
                  <button
                    type="button"
                    className="flag-btn"
                    data-flagged={flagged}
                    disabled={busyId === record.taskId}
                    onClick={() => void toggle(record)}
                    title={
                      flagged
                        ? "Unflag this routing"
                        : "Flag as a misroute (wrong tier or model for the job)"
                    }
                  >
                    {flagged ? "misroute" : "flag"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
