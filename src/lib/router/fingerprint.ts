import { createHash } from "node:crypto";

import type { RouteRequest } from "./types";

/**
 * Stable fingerprint of a task, used as the key for sticky failure
 * memory and for correlating decision-log records.
 *
 * Case- and whitespace-insensitive over the prompt so a re-submitted
 * task with trivial edits still hits its memory entry. Scoped by kind
 * and cwd: the same words as a chat question and as a repo task are
 * different tasks.
 */
export function fingerprintTask(
  request: Pick<RouteRequest, "prompt" | "kind" | "cwd">,
): string {
  const normalizedPrompt = request.prompt
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256")
    .update(`${request.kind}\n${request.cwd ?? ""}\n${normalizedPrompt}`)
    .digest("hex")
    .slice(0, 16);
}
