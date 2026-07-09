import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Manual misroute flags for the telemetry review. Keyed by the decision
 * log's taskId; stored as one JSON file in the data dir. Atomic writes
 * (tmp + rename), corrupt file degrades to empty.
 */

export interface MisrouteFlag {
  flagged: boolean;
  note?: string;
  updatedAt: string;
}

export type MisrouteFlags = Record<string, MisrouteFlag>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function loadMisrouteFlags(filePath: string): MisrouteFlags {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const flags: MisrouteFlags = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (
      isRecord(value) &&
      typeof value.flagged === "boolean" &&
      typeof value.updatedAt === "string"
    ) {
      flags[key] = {
        flagged: value.flagged,
        note: typeof value.note === "string" ? value.note : undefined,
        updatedAt: value.updatedAt,
      };
    }
  }
  return flags;
}

export function saveMisrouteFlag(
  filePath: string,
  taskId: string,
  flag: MisrouteFlag,
): MisrouteFlags {
  const flags = loadMisrouteFlags(filePath);
  if (flag.flagged) {
    flags[taskId] = flag;
  } else {
    delete flags[taskId];
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(flags, null, 2), "utf8");
  renameSync(tmp, filePath);
  return flags;
}
