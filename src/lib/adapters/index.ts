import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import type { Adapter, ProviderId } from "./types";

export const adapters: Record<ProviderId, Adapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
};

export function getAdapter(id: string): Adapter | undefined {
  return id === "claude" || id === "codex" ? adapters[id] : undefined;
}

export type {
  Adapter,
  NormalizedEvent,
  PermissionProfile,
  ProviderId,
  RunOptions,
} from "./types";
export { claudeAdapter, parseClaudeLine } from "./claude";
export { codexAdapter, parseCodexLine } from "./codex";
