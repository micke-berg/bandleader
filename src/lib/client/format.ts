/** Small client-safe formatting helpers shared by the screens. */

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${formatClock(iso)}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatElapsed(sinceIso: string, now: number): string {
  return formatDuration(now - new Date(sinceIso).getTime());
}

export function formatRelative(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return iso;
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Countdown to a reset timestamp, e.g. "2h 14m". Past → "resetting". */
export function formatCountdown(toIso: string, now: number): string {
  const ms = new Date(toIso).getTime() - now;
  if (!Number.isFinite(ms)) return "–";
  if (ms <= 0) return "resetting";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function formatCost(usd: number | undefined): string {
  if (usd === undefined || usd === 0) return "–";
  return `$${usd.toFixed(usd < 0.1 ? 3 : 2)}`;
}

export function formatTokens(count: number | undefined): string {
  if (count === undefined) return "–";
  if (count < 1_000) return String(count);
  return `${(count / 1_000).toFixed(1)}k`;
}
