import path from "node:path";

import config from "../../../../../bandleader.config";
import { fail, ok } from "@/lib/api/envelope";
import { parseMisrouteFlag } from "@/lib/api/validate";
import { saveMisrouteFlag } from "@/lib/telemetry/flags";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("bad_json", "request body must be JSON", 400);
  }

  const parsed = parseMisrouteFlag(body);
  if (!parsed.ok) return fail("invalid_input", parsed.message, 400);

  const filePath = path.join(path.resolve(config.dataDir), "misroutes.json");
  const flags = saveMisrouteFlag(filePath, parsed.value.taskId, {
    flagged: parsed.value.flagged,
    note: parsed.value.note,
    updatedAt: new Date().toISOString(),
  });
  return ok({ flags });
}
