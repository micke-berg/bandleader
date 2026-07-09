import path from "node:path";

import type { PermissionProfile, ProviderId } from "../adapters";
import { isTier, type RouteOverride } from "../router";
import type { TaskInput } from "../tasks";

/**
 * Hand-rolled request validation, consistent with the guard style used
 * in the adapters and router (this repo deliberately avoids schema
 * dependencies). Every route body goes through one of these before it
 * touches the task manager. Localhost tool, but shape is still never
 * trusted.
 */

export const PROMPT_MAX_CHARS = 100_000;
const CWD_MAX_CHARS = 1_000;
const MODEL_MAX_CHARS = 100;
const NOTE_MAX_CHARS = 500;

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

function invalid<T>(message: string): Validated<T> {
  return { ok: false, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PROVIDERS: readonly ProviderId[] = ["claude", "codex"];

function isProvider(value: unknown): value is ProviderId {
  return (
    typeof value === "string" && (PROVIDERS as readonly string[]).includes(value)
  );
}

const PROFILES: readonly PermissionProfile[] = ["read-only", "workspace-write"];

function isPermissionProfile(value: unknown): value is PermissionProfile {
  return (
    typeof value === "string" && (PROFILES as readonly string[]).includes(value)
  );
}

function parseOverride(value: unknown): Validated<RouteOverride | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (!isRecord(value)) return invalid("override must be an object");
  const override: RouteOverride = {};
  if (value.provider !== undefined) {
    if (!isProvider(value.provider))
      return invalid(`override.provider must be one of: ${PROVIDERS.join(", ")}`);
    override.provider = value.provider;
  }
  if (value.model !== undefined) {
    if (
      typeof value.model !== "string" ||
      value.model.trim() === "" ||
      value.model.length > MODEL_MAX_CHARS
    ) {
      return invalid(
        `override.model must be a non-empty string of at most ${MODEL_MAX_CHARS} chars`,
      );
    }
    override.model = value.model;
  }
  if (value.tier !== undefined) {
    if (!isTier(value.tier))
      return invalid("override.tier must be cheap, mid, or frontier");
    override.tier = value.tier;
  }
  return {
    ok: true,
    value: Object.keys(override).length > 0 ? override : undefined,
  };
}

/** Body of POST /api/tasks. */
export function parseTaskInput(body: unknown): Validated<TaskInput> {
  if (!isRecord(body)) return invalid("body must be a JSON object");

  if (typeof body.prompt !== "string" || body.prompt.trim() === "")
    return invalid("prompt is required");
  if (body.prompt.length > PROMPT_MAX_CHARS)
    return invalid(`prompt exceeds ${PROMPT_MAX_CHARS} chars`);

  if (body.kind !== "chat" && body.kind !== "task")
    return invalid('kind must be "chat" or "task"');

  let cwd: string | undefined;
  if (body.cwd !== undefined && body.cwd !== null && body.cwd !== "") {
    if (typeof body.cwd !== "string" || body.cwd.length > CWD_MAX_CHARS)
      return invalid("cwd must be a string");
    if (!path.isAbsolute(body.cwd)) return invalid("cwd must be an absolute path");
    cwd = path.normalize(body.cwd);
  }

  const override = parseOverride(body.override);
  if (!override.ok) return invalid(override.message);

  let permissionProfile: PermissionProfile | undefined;
  if (body.permissionProfile !== undefined) {
    if (!isPermissionProfile(body.permissionProfile))
      return invalid(
        `permissionProfile must be one of: ${PROFILES.join(", ")}`,
      );
    permissionProfile = body.permissionProfile;
  }

  return {
    ok: true,
    value: {
      prompt: body.prompt,
      kind: body.kind,
      cwd,
      override: override.value,
      permissionProfile,
    },
  };
}

export interface MisrouteFlagInput {
  taskId: string;
  flagged: boolean;
  note?: string;
}

/** Body of POST /api/telemetry/flags. */
export function parseMisrouteFlag(body: unknown): Validated<MisrouteFlagInput> {
  if (!isRecord(body)) return invalid("body must be a JSON object");
  if (typeof body.taskId !== "string" || !/^[0-9a-f-]{8,64}$/i.test(body.taskId))
    return invalid("taskId must be a routing task id");
  if (typeof body.flagged !== "boolean")
    return invalid("flagged must be a boolean");
  let note: string | undefined;
  if (body.note !== undefined && body.note !== null && body.note !== "") {
    if (typeof body.note !== "string" || body.note.length > NOTE_MAX_CHARS)
      return invalid(`note must be a string of at most ${NOTE_MAX_CHARS} chars`);
    note = body.note;
  }
  return { ok: true, value: { taskId: body.taskId, flagged: body.flagged, note } };
}
