/**
 * The shared event model every provider adapter normalizes into.
 *
 * Adapters orchestrate the OFFICIAL provider CLIs as subprocesses on the
 * user's own subscription logins. They never call provider APIs with plan
 * credentials and never extract OAuth tokens.
 */

export type ProviderId = "claude" | "codex";

export type NormalizedEvent =
  | {
      type: "session_started";
      sessionId: string;
      model: string;
      provider: ProviderId;
    }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; name: string; summary: string }
  | {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
    }
  | { type: "rate_limited"; retryable: boolean; detail: string }
  | {
      /**
       * Plan-window heartbeat. Claude emits one per run with the current
       * subscription window's status and reset time; Codex has no
       * equivalent. Informational — a non-"allowed" status additionally
       * produces a `rate_limited` event.
       */
      type: "plan_window";
      provider: ProviderId;
      status: string;
      /** ISO timestamp of when the current plan window resets. */
      resetsAt?: string;
      /** Window granularity as reported, e.g. "five_hour". */
      windowType?: string;
    }
  | { type: "error"; detail: string }
  | { type: "completed"; resultText: string; sessionId: string };

/**
 * Most restrictive first. "read-only" is the default for every run:
 * the agent can read the workspace but not write to it.
 */
export type PermissionProfile = "read-only" | "workspace-write";

export interface RunOptions {
  prompt: string;
  /** Provider-specific model name. Omit for the CLI's default. */
  model?: string;
  /** Working directory for the spawned CLI. Defaults to process.cwd(). */
  cwd?: string;
  /**
   * Resume a previous session. For Claude this is the `session_id` from
   * `session_started` (resume is scoped to the same cwd). For Codex it is
   * the thread id.
   */
  resumeSessionId?: string;
  /** Defaults to "read-only". */
  permissionProfile?: PermissionProfile;
}

export interface Adapter {
  id: ProviderId;
  displayName: string;
  /** Models known to be covered by the subscription plan. */
  models: string[];
  run(opts: RunOptions): AsyncIterable<NormalizedEvent>;
}
