import { spawnLineStream } from "./spawn";
import type { Adapter, NormalizedEvent, RunOptions } from "./types";

/**
 * Adapter for the official Claude Code CLI (`claude`).
 *
 * Spawns `claude -p` in headless streaming mode on the user's own plan
 * login. The only compliant subscription path is through the official
 * binary: never call the Anthropic API with plan credentials, never
 * extract OAuth tokens, never use `--bare` (it skips the keychain and
 * requires an API key).
 */

const TOOL_SUMMARY_MAX = 120;
const RATE_LIMIT_PATTERN = /rate.?limit|overloaded|429|529/i;

function summarizeToolInput(input: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(input) ?? "";
  } catch {
    text = String(input);
  }
  return text.length > TOOL_SUMMARY_MAX
    ? `${text.slice(0, TOOL_SUMMARY_MAX)}…`
    : text;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/**
 * Parse one NDJSON line from `claude -p --output-format stream-json
 * --verbose --include-partial-messages` into zero or more NormalizedEvents.
 *
 * Pure function: no process state, safe to test against fixtures.
 * Unknown and malformed lines are tolerated and produce no events.
 */
export function parseClaudeLine(line: string): NormalizedEvent[] {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(data)) return [];

  switch (data.type) {
    case "system": {
      if (data.subtype === "init") {
        return [
          {
            type: "session_started",
            sessionId: str(data.session_id) ?? "",
            model: str(data.model) ?? "",
            provider: "claude",
          },
        ];
      }
      if (data.subtype === "api_retry") {
        // Emitted when the CLI transparently retries the API. Only surface
        // it when it looks like a rate limit / overload, so the router
        // (S2) can fail over to the other plan.
        if (RATE_LIMIT_PATTERN.test(line)) {
          return [
            {
              type: "rate_limited",
              retryable: true,
              detail: str(data.error) ?? str(data.message) ?? line.slice(0, 300),
            },
          ];
        }
      }
      return [];
    }

    case "rate_limit_event": {
      const info = isRecord(data.rate_limit_info) ? data.rate_limit_info : {};
      const status = str(info.status);
      // "allowed" is the healthy heartbeat; anything else means the plan
      // window is throttling us.
      if (status !== undefined && status !== "allowed") {
        return [
          {
            type: "rate_limited",
            retryable: true,
            detail: `plan rate limit status: ${status}`,
          },
        ];
      }
      return [];
    }

    case "stream_event": {
      const event = isRecord(data.event) ? data.event : {};
      if (event.type === "content_block_delta") {
        const delta = isRecord(event.delta) ? event.delta : {};
        if (delta.type === "text_delta") {
          const text = str(delta.text);
          if (text !== undefined) return [{ type: "text_delta", text }];
        }
      }
      return [];
    }

    case "assistant": {
      // Complete assistant messages carry finished tool_use blocks with
      // full input (the streaming deltas only carry partial JSON).
      const message = isRecord(data.message) ? data.message : {};
      const content = Array.isArray(message.content) ? message.content : [];
      const events: NormalizedEvent[] = [];
      for (const block of content) {
        if (isRecord(block) && block.type === "tool_use") {
          events.push({
            type: "tool_call",
            name: str(block.name) ?? "unknown",
            summary: summarizeToolInput(block.input),
          });
        }
      }
      return events;
    }

    case "result": {
      const events: NormalizedEvent[] = [];
      const usage = isRecord(data.usage) ? data.usage : {};
      events.push({
        type: "usage",
        inputTokens: num(usage.input_tokens),
        outputTokens: num(usage.output_tokens),
        costUsd: num(data.total_cost_usd),
      });
      if (data.is_error === true || data.subtype !== "success") {
        events.push({
          type: "error",
          detail: str(data.result) ?? str(data.subtype) ?? "unknown error",
        });
      } else {
        events.push({
          type: "completed",
          resultText: str(data.result) ?? "",
          sessionId: str(data.session_id) ?? "",
        });
      }
      return events;
    }

    default:
      return [];
  }
}

export const claudeAdapter: Adapter = {
  id: "claude",
  displayName: "Claude Code",
  // Plan-covered tiers on the Max plan. Aliases resolve to the current
  // Sonnet / Opus versions.
  models: ["sonnet", "opus"],

  async *run(opts: RunOptions): AsyncIterable<NormalizedEvent> {
    const args = [
      "-p",
      opts.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];
    if (opts.model !== undefined) args.push("--model", opts.model);
    // Resume is scoped to the same cwd as the original session.
    if (opts.resumeSessionId !== undefined)
      args.push("--resume", opts.resumeSessionId);
    if (opts.permissionProfile === "workspace-write")
      args.push("--permission-mode", "acceptEdits");

    // Strip API credentials so the CLI always bills the subscription
    // login, never a stray API key.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;

    const { lines, exit } = spawnLineStream("claude", args, {
      cwd: opts.cwd,
      env,
    });

    let finished = false;
    for await (const line of lines) {
      for (const event of parseClaudeLine(line)) {
        if (event.type === "completed" || event.type === "error")
          finished = true;
        yield event;
      }
    }

    const { code, stderr } = await exit;
    if (code !== 0 && !finished) {
      yield {
        type: "error",
        detail: `claude exited with code ${code}: ${stderr.slice(0, 500)}`,
      };
    }
  },
};
