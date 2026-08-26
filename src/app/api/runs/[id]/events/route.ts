import type { RunResult } from "@/lib/contracts";
import { runStore } from "@/lib/run-store";

import { jsonError } from "../../../_lib/http";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const terminal = new Set<RunResult["status"]>([
  "completed",
  "partial_failure",
  "failed",
]);

function event(name: string, data: unknown) {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const initial = await runStore.getPersistent(id);
  if (!initial) return jsonError(404, "Run not found");

  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        controller.close();
      };

      const send = (run: RunResult) => {
        if (closed) return;
        controller.enqueue(event("run", run));
        if (terminal.has(run.status)) close();
      };

      controller.enqueue(event("run", initial));
      if (terminal.has(initial.status)) {
        close();
        return;
      }

      unsubscribe = runStore.subscribe(id, send);
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15_000);
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      closed = true;
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
