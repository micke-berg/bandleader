import { ok } from "@/lib/api/envelope";
import { listProjects } from "@/lib/status/projects";

export async function GET(): Promise<Response> {
  return ok({ projects: listProjects() });
}
