import { experimentPersistenceConfigured } from "@/lib/experiment-repository";
import {
  browserWorkerReady,
  experimentQueueReady,
} from "@/lib/experiment-queue";

export const dynamic = "force-dynamic";

export async function GET() {
  const [queue, worker] = await Promise.all([
    experimentQueueReady(),
    browserWorkerReady(),
  ]);
  const database = experimentPersistenceConfigured();
  const ready = database && queue && worker;
  return Response.json(
    { status: ready ? "ready" : "not_ready", database, queue, worker },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

