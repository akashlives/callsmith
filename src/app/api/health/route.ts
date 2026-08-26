import { persistenceConfigured } from "@/lib/run-persistence";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      status: "ok",
      service: "callsmith-web",
      persistence: persistenceConfigured() ? "memory+postgres" : "memory",
      modelRunnerConfigured: Boolean(process.env.OPENAI_API_KEY),
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
