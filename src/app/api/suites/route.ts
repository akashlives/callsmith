import { listSuites } from "@/lib/suites";

import { jsonError } from "../_lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { suites: listSuites() },
    { headers: { "cache-control": "no-store" } },
  );
}

export function POST() {
  return jsonError(410, "Public suite imports are disabled", {
    endpoint: "/api/suite-drafts",
    action: "Create a private draft and publish it with an unlisted capability.",
  });
}
