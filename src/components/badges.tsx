import type { ProviderId } from "@/lib/adapters";
import type { Tier } from "@/lib/router";
import type { TaskStatus } from "@/lib/tasks/types";

/**
 * The transparency invariant, rendered: every routed task shows which
 * model got it (ModelBadge) next to the one-line reason. Presentational
 * only — colour comes from tokens.css via data attributes.
 */

const PROVIDER_LABEL: Record<ProviderId, string> = {
  claude: "Claude",
  codex: "Codex",
};

export function ModelBadge({
  provider,
  model,
  title,
}: {
  provider?: ProviderId;
  model?: string;
  title?: string;
}) {
  if (provider === undefined || model === undefined) {
    return (
      <span className="model-badge" data-provider="auto" title={title ?? "not routed yet"}>
        routing…
      </span>
    );
  }
  return (
    <span className="model-badge" data-provider={provider} title={title}>
      {PROVIDER_LABEL[provider]} · {model}
    </span>
  );
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  routing: "routing",
  running: "running",
  verifying: "verifying",
  escalated: "escalated",
  done: "done",
  failed: "failed",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className="status" data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function TierChip({ tier }: { tier: Tier }) {
  return (
    <span className="tier-chip" data-tier={tier}>
      {tier}
    </span>
  );
}
