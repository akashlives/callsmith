import { persistenceConfigured } from "@/lib/run-persistence";
import { browserQueueConfigured } from "@/lib/run-queue";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      status: "ok",
      service: "callsmith-web",
      persistence: persistenceConfigured() ? "memory+postgres" : "memory",
      modelRunnerConfigured: Boolean(process.env.OPENAI_API_KEY),
      browserQueueConfigured: browserQueueConfigured(),
      browserRunnerConfigured:
        browserQueueConfigured() &&
        Boolean(process.env.OPENAI_API_KEY) &&
        Boolean(process.env.CALLSMITH_RUNNER_TOKEN),
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
