import { fail } from "@/lib/api/envelope";
import { formatSseEvent, SSE_HEADERS, sseHeartbeat } from "@/lib/api/sse";
import { getTaskManager, isTerminalStatus } from "@/lib/tasks";
import type { TaskStreamEvent } from "@/lib/tasks";

const HEARTBEAT_MS = 15_000;

/**
 * SSE stream for one task: replays the buffered RouterEvents, then
 * forwards live ones. Ends after the terminal task snapshot, so a
 * finished task's stream replays its history and closes.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const manager = getTaskManager();
  const task = manager.get(id);
  if (task === undefined) return fail("not_found", `no task ${id}`, 404);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const cleanups: Array<() => void> = [];

      const close = (): void => {
        if (closed) return;
        closed = true;
        for (const cleanup of cleanups) cleanup();
        try {
          controller.close();
        } catch {
          // already closed by the runtime
        }
      };

      const send = (event: TaskStreamEvent): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(formatSseEvent(event)));
        } catch {
          close();
          return;
        }
        if (event.type === "task" && isTerminalStatus(event.task.status)) {
          close();
        }
      };

      // This whole block is synchronous, so replaying first and then
      // subscribing is gap-free: the pipeline can only append events at
      // async boundaries, never between these statements.
      for (const routerEvent of manager.events(id)) {
        send({ type: "router", event: routerEvent });
        if (closed) return;
      }
      const current = manager.get(id);
      if (current !== undefined) send({ type: "task", task: current });
      if (closed) return;

      cleanups.push(manager.subscribe(id, send));

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseHeartbeat()));
        } catch {
          close();
        }
      }, HEARTBEAT_MS);
      cleanups.push(() => clearInterval(heartbeat));

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
