import { experimentPersistenceConfigured } from "@/lib/experiment-repository";
import {
  browserWorkerReady,
  experimentQueueConfigured,
  experimentQueueReady,
} from "@/lib/experiment-queue";
import { frameworkManifest } from "@/lib/framework-manifest";

export const dynamic = "force-dynamic";

export async function GET() {
  const [queueReady, workerReady, framework] = await Promise.all([
    experimentQueueReady(),
    browserWorkerReady(),
    frameworkManifest(),
  ]);
  const persistence = experimentPersistenceConfigured();
  const ready = persistence && queueReady && workerReady;
  return Response.json(
    {
      status: ready ? "ready" : "degraded",
      service: "callsmith-web",
      persistence: persistence ? "postgres" : "development-memory",
      queue: queueReady ? "ready" : "unavailable",
      worker: workerReady ? "ready" : "unavailable",
      browserQueueConfigured: experimentQueueConfigured(),
      browserRunnerConfigured: workerReady && Boolean(process.env.OPENAI_API_KEY),
      framework,
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
