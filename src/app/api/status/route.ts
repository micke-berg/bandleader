import config from "../../../../bandleader.config";
import { ok } from "@/lib/api/envelope";
import { providerStatuses } from "@/lib/status/providers";
import { getTaskManager } from "@/lib/tasks";
import { TIERS, type ModelRef } from "@/lib/router";

/** Unique plan-covered (provider, model) pairs, cheap → frontier order. */
function overrideOptions(): ModelRef[] {
  const seen = new Set<string>();
  const options: ModelRef[] = [];
  for (const tier of TIERS) {
    for (const ref of config.tiers[tier].preference) {
      const key = `${ref.provider}/${ref.model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(ref);
    }
  }
  return options;
}

export async function GET(): Promise<Response> {
  const manager = getTaskManager();
  const planWindows = manager.getPlanWindows();
  const providers = providerStatuses().map((status) => ({
    ...status,
    planWindow: planWindows[status.provider],
  }));
  return ok({ providers, overrideOptions: overrideOptions() });
}
