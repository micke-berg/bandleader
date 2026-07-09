import path from "node:path";

import config from "../../../../bandleader.config";
import { ok } from "@/lib/api/envelope";
import { loadMisrouteFlags } from "@/lib/telemetry/flags";
import { aggregateDecisions, readDecisions } from "@/lib/telemetry/read";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1_000;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const dataDir = path.resolve(config.dataDir);
  const decisions = readDecisions(path.join(dataDir, "decisions.jsonl"), limit);
  const stats = aggregateDecisions(decisions);
  const flags = loadMisrouteFlags(path.join(dataDir, "misroutes.json"));

  return ok({ decisions, stats, flags });
}
