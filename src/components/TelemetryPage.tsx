"use client";

import { useEffect, useState } from "react";

import { getStatus, getTelemetry } from "@/lib/client/api";
import type { StatusView, TelemetryView } from "@/lib/client/api";
import { formatCost } from "@/lib/client/format";
import { QuotaStrip } from "./QuotaStrip";
import { TelemetryTable } from "./TelemetryTable";

export function TelemetryPage() {
  const [telemetry, setTelemetry] = useState<TelemetryView>();
  const [status, setStatus] = useState<StatusView>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    getTelemetry()
      .then(setTelemetry)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    getStatus().then(setStatus).catch(() => undefined);
  }, []);

  const stats = telemetry?.stats;
  const flaggedCount =
    telemetry !== undefined
      ? Object.values(telemetry.flags).filter((f) => f.flagged).length
      : 0;

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-title">Telemetry</h1>
          <p className="page-sub">
            Every routing decision, straight from the decision log. Flag misroutes
            here before tuning the rubric.
          </p>
        </div>
      </div>

      {error !== undefined && <div className="error-banner">{error}</div>}

      {status !== undefined && (
        <>
          <div className="section-label" style={{ marginBottom: 8 }}>
            Providers
          </div>
          <QuotaStrip providers={status.providers} />
        </>
      )}

      {stats !== undefined && (
        <div className="stat-tiles">
          <div className="panel stat-tile">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">routings</div>
          </div>
          <div className="panel stat-tile">
            <div className="stat-value">
              {stats.byTier.cheap}·{stats.byTier.mid}·{stats.byTier.frontier}
            </div>
            <div className="stat-label">cheap · mid · frontier</div>
          </div>
          <div className="panel stat-tile" data-tone={stats.escalations > 0 ? "purple" : undefined}>
            <div className="stat-value">{stats.escalations}</div>
            <div className="stat-label">escalations</div>
          </div>
          <div className="panel stat-tile" data-tone={stats.failovers > 0 ? "warn" : undefined}>
            <div className="stat-value">{stats.failovers}</div>
            <div className="stat-label">failovers</div>
          </div>
          <div
            className="panel stat-tile"
            data-tone={stats.verifyFailed + stats.errors > 0 ? "crit" : undefined}
          >
            <div className="stat-value">{stats.verifyFailed + stats.errors}</div>
            <div className="stat-label">failed / unverified</div>
          </div>
          <div className="panel stat-tile" data-tone={flaggedCount > 0 ? "crit" : undefined}>
            <div className="stat-value">{flaggedCount}</div>
            <div className="stat-label">flagged misroutes</div>
          </div>
          <div className="panel stat-tile">
            <div className="stat-value">{formatCost(stats.totalCostUsd)}</div>
            <div className="stat-label">plan-equivalent spend</div>
          </div>
        </div>
      )}

      {telemetry === undefined && error === undefined ? (
        <div className="empty-state">loading…</div>
      ) : telemetry !== undefined ? (
        <TelemetryTable decisions={telemetry.decisions} flags={telemetry.flags} />
      ) : null}
    </main>
  );
}
