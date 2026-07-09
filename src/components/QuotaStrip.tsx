"use client";

import type { ProviderStatusView } from "@/lib/client/api";
import { formatCountdown, formatRelative } from "@/lib/client/format";
import { useNow } from "./useNow";

const PROVIDER_NAME = { claude: "Claude plan", codex: "ChatGPT plan" } as const;
const CLI_NAME = { claude: "claude", codex: "codex" } as const;

function authLine(status: ProviderStatusView): string {
  if (status.binaryPath === null) return `${CLI_NAME[status.provider]} not on PATH`;
  if (!status.loginArtifact) return "no login found";
  return "logged in";
}

function WindowInfo({ status, now }: { status: ProviderStatusView; now: number }) {
  const window = status.planWindow;
  if (window === undefined) {
    return (
      <div className="quota-window">
        <div className="quota-window-label">window</div>
        <div className="quota-window-value" title="No usage heartbeat observed yet">
          no data yet
        </div>
      </div>
    );
  }
  const throttled = window.status !== "allowed";
  return (
    <div className="quota-window">
      <div className="quota-window-label">
        {window.windowType?.replaceAll("_", " ") ?? "window"}
      </div>
      <div
        className="quota-window-value"
        data-tone={throttled ? "crit" : undefined}
        title={`status: ${window.status} · observed ${formatRelative(window.observedAt, now)}`}
      >
        {throttled
          ? `limited · resets ${window.resetsAt !== undefined ? `in ${formatCountdown(window.resetsAt, now)}` : "soon"}`
          : window.resetsAt !== undefined
            ? `resets in ${formatCountdown(window.resetsAt, now)}`
            : window.status}
      </div>
    </div>
  );
}

/**
 * Per-provider plan status. Claude's CLI emits a plan-window heartbeat
 * every run; Codex has no equivalent, so its card degrades honestly.
 */
export function QuotaStrip({ providers }: { providers: ProviderStatusView[] }) {
  const now = useNow(30_000);
  return (
    <div className="quota-strip">
      {providers.map((status) => (
        <div key={status.provider} className="panel quota-card" data-provider={status.provider}>
          <span className="provider-dot" aria-hidden />
          <div>
            <div className="quota-name">{PROVIDER_NAME[status.provider]}</div>
            <div className="quota-meta">{authLine(status)}</div>
          </div>
          <WindowInfo status={status} now={now} />
        </div>
      ))}
    </div>
  );
}
