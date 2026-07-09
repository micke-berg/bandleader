"use client";

import type { RouterEvent } from "@/lib/router";
import { formatCost, formatDuration, formatTokens } from "@/lib/client/format";
import type { TaskRecord } from "@/lib/tasks/types";

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

interface RailStep {
  label: string;
  sub?: string;
  state: "done" | "current" | "pending" | "failed" | "escalated";
}

/** Build the routed → running → verified/escalated → done rail. */
export function buildRail(
  task: TaskRecord | undefined,
  events: RouterEvent[],
): RailStep[] {
  const steps: RailStep[] = [];
  for (const event of events) {
    switch (event.type) {
      case "decision":
        steps.push({
          label: "routed",
          sub: `${event.decision.decidedBy} → ${event.decision.tier}`,
          state: "done",
        });
        break;
      case "attempt_started":
        steps.push({
          label: `running ${event.provider}/${event.model}`,
          sub: event.tier,
          state: "done",
        });
        break;
      case "failover":
        steps.push({
          label: "failover",
          sub: `${event.failover.to.provider}/${event.failover.to.model}`,
          state: "escalated",
        });
        break;
      case "verifying":
        steps.push({ label: `verifying (${event.verifier})`, state: "done" });
        break;
      case "escalated":
        steps.push({
          label: `escalated to ${event.escalation.toTier}`,
          sub: event.escalation.verifier,
          state: "escalated",
        });
        break;
      default:
        break;
    }
  }
  if (steps.length === 0) steps.push({ label: "routing", state: "current" });

  if (task === undefined || (task.status !== "done" && task.status !== "failed")) {
    const last = steps[steps.length - 1];
    if (last !== undefined && last.state === "done") last.state = "current";
  } else {
    steps.push({
      label: task.status === "done" ? (task.result?.outcome ?? "done") : "failed",
      sub: task.result !== undefined ? formatDuration(task.result.durationMs) : undefined,
      state: task.status === "done" ? "done" : "failed",
    });
  }
  return steps;
}

export function TimelineRail({
  task,
  events,
}: {
  task: TaskRecord | undefined;
  events: RouterEvent[];
}) {
  const steps = buildRail(task, events);
  const usage = task?.result?.usage;
  return (
    <aside className="panel rail" aria-label="Timeline">
      <div className="section-label">Timeline</div>
      <div className="rail-steps">
        {steps.map((step, index) => (
          <div key={index} className="rail-step" data-state={step.state}>
            <span className="rail-dot" aria-hidden />
            <div>
              <div className="rail-label">{step.label}</div>
              {step.sub !== undefined && <div className="rail-sub">{step.sub}</div>}
            </div>
          </div>
        ))}
      </div>
      {task !== undefined && (
        <dl className="rail-meta">
          <div className="rail-meta-row">
            <dt>kind</dt>
            <dd>{task.kind}</dd>
          </div>
          <div className="rail-meta-row">
            <dt>access</dt>
            <dd>{task.permissionProfile}</dd>
          </div>
          {task.cwd !== undefined && (
            <div className="rail-meta-row">
              <dt>project</dt>
              <dd title={task.cwd}>{basename(task.cwd)}</dd>
            </div>
          )}
          {task.result?.sessionId !== undefined && (
            <div className="rail-meta-row">
              <dt>session</dt>
              <dd>{task.result.sessionId.slice(0, 8)}</dd>
            </div>
          )}
          {usage !== undefined && (
            <div className="rail-meta-row">
              <dt>tokens</dt>
              <dd>
                {formatTokens(usage.inputTokens)} in · {formatTokens(usage.outputTokens)} out
              </dd>
            </div>
          )}
          {usage?.costUsd !== undefined && (
            <div className="rail-meta-row">
              <dt>plan-equiv</dt>
              <dd>{formatCost(usage.costUsd)}</dd>
            </div>
          )}
        </dl>
      )}
    </aside>
  );
}
