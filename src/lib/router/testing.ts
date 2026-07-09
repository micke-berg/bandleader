/**
 * Test doubles for router tests. Not used at runtime.
 *
 * FakeAdapter implements the REAL Adapter interface from the adapter
 * layer (not a structural stub), so router tests exercise exactly the
 * surface the real CLIs are driven through.
 */

import type {
  Adapter,
  NormalizedEvent,
  ProviderId,
  RunOptions,
} from "../adapters";

export type ScriptedRun = (opts: RunOptions) => NormalizedEvent[];

export class FakeAdapter implements Adapter {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly models: string[];
  readonly calls: RunOptions[] = [];
  private readonly script: ScriptedRun;

  constructor(id: ProviderId, models: string[], script: ScriptedRun) {
    this.id = id;
    this.displayName = `Fake ${id}`;
    this.models = models;
    this.script = script;
  }

  async *run(opts: RunOptions): AsyncIterable<NormalizedEvent> {
    this.calls.push(opts);
    for (const event of this.script(opts)) {
      yield event;
    }
  }
}

export function okEvents(
  provider: ProviderId,
  resultText: string,
  sessionId = `${provider}-sess-1`,
  model = "fake",
): NormalizedEvent[] {
  return [
    { type: "session_started", sessionId, model, provider },
    { type: "text_delta", text: resultText },
    { type: "usage", inputTokens: 10, outputTokens: 5 },
    { type: "completed", resultText, sessionId },
  ];
}

export function rateLimitedEvents(
  provider: ProviderId,
  detail = "rate limit hit",
): NormalizedEvent[] {
  return [
    {
      type: "session_started",
      sessionId: `${provider}-sess-rl`,
      model: "fake",
      provider,
    },
    { type: "rate_limited", retryable: true, detail },
    { type: "error", detail },
  ];
}

export function errorEvents(
  provider: ProviderId,
  detail = "something broke",
): NormalizedEvent[] {
  return [
    {
      type: "session_started",
      sessionId: `${provider}-sess-err`,
      model: "fake",
      provider,
    },
    { type: "error", detail },
  ];
}
