import { runnerAuthorized } from "@/app/api/_server/runner-auth";
import { experimentRepository } from "@/lib/experiment-repository";

import { jsonError } from "../../../../_lib/http";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!runnerAuthorized(request)) return jsonError(401, "Runner authentication failed");
  const { id } = await params;
  const experiment = await experimentRepository.getInternal(id);
  const suite = await experimentRepository.getSuite(id);
  if (!experiment || !suite) return jsonError(404, "Experiment not found");
  return Response.json(
    { experiment, suite, scenario: suite.scenarios[0] },
    { headers: { "cache-control": "no-store, private" } },
  );
}

