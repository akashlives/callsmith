import { listSuites } from "@/lib/suites";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { suites: listSuites() },
    { headers: { "cache-control": "no-store" } },
  );
}
