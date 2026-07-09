"use client";

import Link from "next/link";

import { formatDuration, formatElapsed, formatRelative } from "@/lib/client/format";
import type { TaskRecord } from "@/lib/tasks/types";
import { ModelBadge, StatusBadge } from "./badges";

/**
 * One task on the stage. The badge + one-line reason are always visible
 * (the transparency invariant); running tasks show live elapsed time.
 */
export function TaskCard({
  task,
  now,
  selected,
}: {
  task: TaskRecord;
  now: number;
  selected?: boolean;
}) {
  const terminal = task.status === "done" || task.status === "failed";
  const provider = task.result?.finalProvider ?? task.decision?.provider;
  const model = task.result?.finalModel ?? task.decision?.model;
  const reason = task.result?.reason ?? task.decision?.reason ?? "deciding which model takes this…";

  return (
    <article className="panel task-card" data-selected={selected === true}>
      <Link href={`/tasks/${task.id}`}>
        <div className="task-card-top">
          <StatusBadge status={task.status} />
          <h3 className="task-title">{task.title}</h3>
          {task.kind === "chat" && <span className="task-kind-chip">chat</span>}
          <ModelBadge provider={provider} model={model} title={reason} />
        </div>
        <div className="task-card-meta">
          <span className="routing-reason" title={reason}>
            {reason}
          </span>
          <span className="task-time">
            {terminal
              ? `${task.result !== undefined ? formatDuration(task.result.durationMs) : "–"} · ${formatRelative(task.createdAt, now)}`
              : formatElapsed(task.createdAt, now)}
          </span>
        </div>
      </Link>
    </article>
  );
}
