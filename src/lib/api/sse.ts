/**
 * Server-sent events framing. One place turns a payload into the wire
 * format so the stream route stays trivial and the format is testable.
 */

export interface SseOptions {
  event?: string;
  id?: string;
}

/** Serialize one SSE message. `data` is JSON-encoded onto data: lines. */
export function formatSseEvent(data: unknown, options: SseOptions = {}): string {
  let out = "";
  if (options.event !== undefined) out += `event: ${options.event}\n`;
  if (options.id !== undefined) out += `id: ${options.id}\n`;
  // JSON.stringify never emits raw newlines, but split defensively so a
  // future non-JSON payload cannot break the framing.
  const encoded = JSON.stringify(data) ?? "null";
  for (const line of encoded.split(/\r?\n/)) {
    out += `data: ${line}\n`;
  }
  return `${out}\n`;
}

/** An SSE comment line, used as a keep-alive heartbeat. */
export function sseHeartbeat(): string {
  return ": heartbeat\n\n";
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;
