import { fail, ok } from "@/lib/api/envelope";
import { getTaskManager } from "@/lib/tasks";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const manager = getTaskManager();
  const task = manager.get(id);
  if (task === undefined) return fail("not_found", `no task ${id}`, 404);
  return ok({ task, events: manager.events(id) });
}
