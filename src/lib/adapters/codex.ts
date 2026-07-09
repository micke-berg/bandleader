import { spawnLineStream } from "./spawn";
import type { Adapter, NormalizedEvent, RunOptions } from "./types";

/**
 * Adapter for the official Codex CLI (`codex`).
 *
 * Spawns `codex exec --json` on the user's ChatGPT plan login (OpenAI
 * explicitly endorses third-party harnesses driving Codex on plan
 * sign-in). Emits JSONL thread/turn/item events.
 *
 * CLI quirk: global flags (`--json`, `--sandbox`, `--model`) must come
 * BEFORE the `resume` subcommand, or clap rejects them.
 */

const SUMMARY_MAX = 120;
const RATE_LIMIT_PATTERN = /rate.?limit|too many requests|429|usage limit/i;

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

function truncate(text: string): string {
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text;
}

function failureEvent(detail: string): NormalizedEvent {
  return RATE_LIMIT_PATTERN.test(detail)
    ? { type: "rate_limited", retryable: true, detail }
    : { type: "error", detail };
}

/**
 * Parse one JSONL line from `codex exec --json` into zero or more
 * NormalizedEvents.
 *
 * Pure function: no process state, safe to test against fixtures.
 * Unknown and malformed lines are tolerated and produce no events.
 *
 * Note: `thread.started` carries no model name, and Codex agent messages
 * arrive complete (not token-streamed), so a full message becomes a
 * single text_delta. The final `completed` event is synthesized by the
 * adapter when the process exits, since the JSONL stream has no result
 * event of its own.
 */
export function parseCodexLine(line: string): NormalizedEvent[] {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(data)) return [];

  switch (data.type) {
    case "thread.started": {
      return [
        {
          type: "session_started",
          sessionId: str(data.thread_id) ?? "",
          // The JSONL stream does not name the model; the CLI uses the
          // configured/requested one. The adapter overrides this with the
          // requested model when one was passed.
          model: "default",
          provider: "codex",
        },
      ];
    }

    case "item.started": {
      const item = isRecord(data.item) ? data.item : {};
      if (item.type === "command_execution") {
        return [
          {
            type: "tool_call",
            name: "command_execution",
            summary: truncate(str(item.command) ?? ""),
          },
        ];
      }
      return [];
    }

    case "item.completed": {
      const item = isRecord(data.item) ? data.item : {};
      if (item.type === "agent_message") {
        const text = str(item.text);
        if (text !== undefined) return [{ type: "text_delta", text }];
      }
      // command_execution completions are ignored: the tool_call was
      // already emitted from item.started.
      return [];
    }

    case "turn.completed": {
      const usage = isRecord(data.usage) ? data.usage : {};
      return [
        {
          type: "usage",
          inputTokens: num(usage.input_tokens),
          outputTokens: num(usage.output_tokens),
          // Plan-covered runs have no per-request cost; Codex reports none.
        },
      ];
    }

    case "turn.failed": {
      const error = isRecord(data.error) ? data.error : {};
      const detail =
        str(error.message) ?? str(data.message) ?? line.slice(0, 300);
      return [failureEvent(detail)];
    }

    case "error": {
      const detail = str(data.message) ?? line.slice(0, 300);
      return [failureEvent(detail)];
    }

    default:
      return [];
  }
}

export const codexAdapter: Adapter = {
  id: "codex",
  displayName: "Codex CLI",
  // Plan-covered tiers on the ChatGPT plan.
  models: ["gpt-5.6-terra", "gpt-5.6-sol"],

  async *run(opts: RunOptions): AsyncIterable<NormalizedEvent> {
    // Global flags must precede the `resume` subcommand.
    const args = ["exec", "--json"];
    args.push(
      "--sandbox",
      opts.permissionProfile === "workspace-write"
        ? "workspace-write"
        : "read-only",
    );
    if (opts.model !== undefined) args.push("--model", opts.model);
    if (opts.resumeSessionId !== undefined)
      args.push("resume", opts.resumeSessionId);
    args.push(opts.prompt);

    const { lines, exit } = spawnLineStream("codex", args, {
      cwd: opts.cwd,
      env: process.env,
    });

    let sessionId = "";
    let lastMessage = "";
    let failed = false;

    for await (const line of lines) {
      for (const event of parseCodexLine(line)) {
        if (event.type === "session_started") {
          sessionId = event.sessionId;
          if (opts.model !== undefined) {
            yield { ...event, model: opts.model };
            continue;
          }
        }
        if (event.type === "text_delta") lastMessage = event.text;
        if (event.type === "error" || event.type === "rate_limited")
          failed = true;
        yield event;
      }
    }

    const { code, stderr } = await exit;
    if (code !== 0 && !failed) {
      yield {
        type: "error",
        detail: `codex exited with code ${code}: ${stderr.slice(0, 500)}`,
      };
    } else if (!failed) {
      // The JSONL stream has no terminal result event; synthesize one.
      yield { type: "completed", resultText: lastMessage, sessionId };
    }
  },
};
