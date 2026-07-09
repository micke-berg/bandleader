import { accessSync, constants, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ProviderId } from "../adapters";

/**
 * Per-provider status for the quota strip and telemetry screen. All
 * checks are local and free: PATH lookup for the binary, login-artifact
 * presence for auth. Neither spends quota nor spawns a CLI. The UI
 * labels these honestly as artifact checks, not live verification.
 */

export interface ProviderStatus {
  provider: ProviderId;
  /** Absolute path of the CLI on PATH, or null when not found. */
  binaryPath: string | null;
  /** A login artifact exists locally (not a live auth check). */
  loginArtifact: boolean;
}

function findOnPath(binary: string): string | null {
  const pathVar = process.env.PATH ?? "";
  for (const dir of pathVar.split(path.delimiter)) {
    if (dir === "") continue;
    const candidate = path.join(dir, binary);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function claudeLoginArtifact(): boolean {
  const home = os.homedir();
  // macOS stores the OAuth token in the keychain; ~/.claude.json records
  // the logged-in account. Linux keeps credentials under ~/.claude/.
  try {
    const config = readFileSync(path.join(home, ".claude.json"), "utf8");
    if (config.includes('"oauthAccount"')) return true;
  } catch {
    // fall through
  }
  try {
    accessSync(path.join(home, ".claude", ".credentials.json"), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function codexLoginArtifact(): boolean {
  try {
    accessSync(path.join(os.homedir(), ".codex", "auth.json"), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

let cache: { at: number; statuses: ProviderStatus[] } | undefined;
const CACHE_MS = 60_000;

export function providerStatuses(): ProviderStatus[] {
  if (cache !== undefined && Date.now() - cache.at < CACHE_MS) {
    return cache.statuses;
  }
  const statuses: ProviderStatus[] = [
    {
      provider: "claude",
      binaryPath: findOnPath("claude"),
      loginArtifact: claudeLoginArtifact(),
    },
    {
      provider: "codex",
      binaryPath: findOnPath("codex"),
      loginArtifact: codexLoginArtifact(),
    },
  ];
  cache = { at: Date.now(), statuses };
  return statuses;
}
