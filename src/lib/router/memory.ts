import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { isTier, maxTier, type Tier } from "./types";

export interface FailureMemoryEntry {
  tier: Tier;
  count: number;
  updatedAt: string;
}

/**
 * Sticky failure memory (part of Layer 1). When a task fingerprint had
 * to escalate, it is recorded here so the same task starts at the higher
 * tier next time instead of failing cheap first again.
 *
 * File-backed JSON in the gitignored data dir. Corrupt or missing files
 * degrade to an empty memory: losing memory only costs one re-escalation,
 * never a crash.
 */
export class FailureMemory {
  private readonly filePath: string;
  private entries: Record<string, FailureMemoryEntry> | undefined;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private load(): Record<string, FailureMemoryEntry> {
    if (this.entries !== undefined) return this.entries;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch {
      parsed = undefined;
    }
    const entries: Record<string, FailureMemoryEntry> = {};
    if (typeof parsed === "object" && parsed !== null) {
      for (const [key, value] of Object.entries(parsed)) {
        if (
          typeof value === "object" &&
          value !== null &&
          "tier" in value &&
          isTier((value as { tier: unknown }).tier)
        ) {
          const record = value as { tier: Tier; count?: unknown; updatedAt?: unknown };
          entries[key] = {
            tier: record.tier,
            count: typeof record.count === "number" ? record.count : 1,
            updatedAt:
              typeof record.updatedAt === "string"
                ? record.updatedAt
                : new Date(0).toISOString(),
          };
        }
      }
    }
    this.entries = entries;
    return entries;
  }

  /** The tier this fingerprint previously escalated to, if any. */
  get(fingerprint: string): Tier | undefined {
    return this.load()[fingerprint]?.tier;
  }

  /**
   * Record that this fingerprint needed `tier`. Only ever raises the
   * remembered tier (sticky, never downgraded).
   */
  recordEscalation(fingerprint: string, tier: Tier, now = new Date()): void {
    const entries = this.load();
    const existing = entries[fingerprint];
    entries[fingerprint] = {
      tier: existing ? maxTier(existing.tier, tier) : tier,
      count: (existing?.count ?? 0) + 1,
      updatedAt: now.toISOString(),
    };
    this.save(entries);
  }

  private save(entries: Record<string, FailureMemoryEntry>): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    // Atomic write: never leave a half-written memory file behind.
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
    renameSync(tmpPath, this.filePath);
  }
}
