import { existsSync } from "node:fs";

import { fail, ok } from "@/lib/api/envelope";
import { parseTaskInput } from "@/lib/api/validate";
import { getTaskManager } from "@/lib/tasks";

export async function GET(): Promise<Response> {
  return ok({ tasks: getTaskManager().list() });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("bad_json", "request body must be JSON", 400);
  }

  const parsed = parseTaskInput(body);
  if (!parsed.ok) return fail("invalid_input", parsed.message, 400);

  if (parsed.value.cwd !== undefined && !existsSync(parsed.value.cwd)) {
    return fail("invalid_input", `cwd does not exist: ${parsed.value.cwd}`, 400);
  }

  const task = getTaskManager().create(parsed.value);
  return ok({ task }, { status: 201 });
}
