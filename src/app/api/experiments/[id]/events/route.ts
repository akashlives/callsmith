import { experimentRepository } from "@/lib/experiment-repository";
import { readExperimentEvents } from "@/lib/experiment-queue";
import { compactExperimentStatus } from "@/lib/experiments";

import { jsonError } from "../../../_lib/http";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const terminal = new Set(["completed", "partial_failure", "failed"]);

function bearer(request: Request): string {
  return (
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    ""
  );
}

function event(name: string, data: unknown, id?: string) {
  return encoder.encode(
    `${id ? `id: ${id}\n` : ""}event: ${name}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const accessToken = bearer(request);
  const initial = await experimentRepository.get(id, accessToken);
  if (!initial) return jsonError(404, "Experiment not found");
  // Start at the beginning when a client has no cursor. The compact database
  // snapshot above deduplicates state, while replaying the Redis stream closes
  // the race between authorization and the first blocking read.
  let cursor = request.headers.get("last-event-id") || "0-0";
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(event("experiment", compactExperimentStatus(initial)));
      if (terminal.has(initial.status)) {
        closed = true;
        controller.close();
      }
    },
    async pull(controller) {
      if (closed) return;
      if (request.signal.aborted) {
        closed = true;
        controller.close();
        return;
      }
      const events = await readExperimentEvents(id, cursor);
      if (events.length === 0) {
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
        return;
      }
      for (const item of events) {
        cursor = item.id;
        controller.enqueue(event("progress", item.event, item.id));
      }
      const current = await experimentRepository.get(id, accessToken);
      if (current && terminal.has(current.status)) {
        controller.enqueue(event("experiment", compactExperimentStatus(current)));
        closed = true;
        controller.close();
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform, private",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
