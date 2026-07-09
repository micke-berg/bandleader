"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { openTaskStream } from "@/lib/client/api";
import { formatDateTime, formatElapsed } from "@/lib/client/format";
import type { RouterEvent } from "@/lib/router";
import type { TaskRecord } from "@/lib/tasks/types";
import { ModelBadge, StatusBadge, TierChip } from "./badges";
import { RerunMenu } from "./RerunMenu";
import { TimelineRail } from "./TimelineRail";
import { Transcript } from "./Transcript";
import { useNow } from "./useNow";

/**
 * Task detail: the SSE stream replays the task's history and then
 * follows it live, so one subscription covers both finished and running
 * tasks.
 */
export function TaskDetailPage({ id }: { id: string }) {
  const now = useNow();
  const [task, setTask] = useState<TaskRecord>();
  const [events, setEvents] = useState<RouterEvent[]>([]);
  const [streamError, setStreamError] = useState<string>();

  // The page passes key={id}, so an id change remounts this component
  // with fresh state; the effect only manages the stream subscription.
  useEffect(() => {
    return openTaskStream(
      id,
      (event) => {
        if (event.type === "task") setTask(event.task);
        else setEvents((current) => [...current, event.event]);
      },
      (error) => {
        if (error !== undefined) setStreamError(error);
      },
    );
  }, [id]);

  const escalations = events.filter((e) => e.type === "escalated");
  const failovers = events.filter((e) => e.type === "failover");
  const terminal = task?.status === "done" || task?.status === "failed";
  const provider = task?.result?.finalProvider ?? task?.decision?.provider;
  const model = task?.result?.finalModel ?? task?.decision?.model;
  const reason = task?.result?.reason ?? task?.decision?.reason;

  return (
    <main>
      <div className="detail-head">
        <div className="detail-title-row">
          <Link href="/" className="btn btn-ghost" aria-label="Back to the stage">
            ←
          </Link>
          <h1 className="detail-title">{task?.title ?? "task"}</h1>
          {task !== undefined && <StatusBadge status={task.status} />}
          {task?.decision !== undefined && <TierChip tier={task.result?.finalTier ?? task.decision.tier} />}
          <ModelBadge provider={provider} model={model} title={reason} />
          {task !== undefined && !terminal && (
            <span className="task-time">{formatElapsed(task.createdAt, now)}</span>
          )}
          <div style={{ flex: 1 }} />
          {task !== undefined && <RerunMenu task={task} />}
        </div>
        {reason !== undefined && (
          <p className="detail-reason">
            <span className="mono">why:</span> {reason}
          </p>
        )}
        {task !== undefined && (
          <p className="detail-reason">
            <span className="mono">created:</span> {formatDateTime(task.createdAt)}
          </p>
        )}
      </div>

      {streamError !== undefined && task === undefined && (
        <div className="error-banner">
          Could not open this task&apos;s stream ({streamError}). It may not exist —{" "}
          <Link href="/" style={{ textDecoration: "underline" }}>
            back to the stage
          </Link>
          .
        </div>
      )}

      <div className="detail-grid">
        <TimelineRail task={task} events={events} />
        <div>
          <Transcript events={events} task={task} />

          {(escalations.length > 0 || failovers.length > 0) && (
            <section className="panel escalation-panel" aria-label="Escalation history">
              <div className="section-label">Escalation history</div>
              {failovers.map((event, index) =>
                event.type === "failover" ? (
                  <div key={`f${index}`} className="escalation-item">
                    <span className="escalation-mark">⇄ failover</span>
                    <span>
                      {event.failover.from.provider}/{event.failover.from.model} →{" "}
                      {event.failover.to.provider}/{event.failover.to.model}
                    </span>
                    <span className="mono">{event.failover.detail}</span>
                  </div>
                ) : null,
              )}
              {escalations.map((event, index) =>
                event.type === "escalated" ? (
                  <div key={`e${index}`} className="escalation-item">
                    <span className="escalation-mark">↑ escalated</span>
                    <span>
                      {event.escalation.fromTier} → {event.escalation.toTier} after{" "}
                      {event.escalation.verifier} verification failed
                    </span>
                    <span className="mono">{event.escalation.detail.slice(0, 200)}</span>
                  </div>
                ) : null,
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
