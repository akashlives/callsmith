import { experimentRepository } from "@/lib/experiment-repository";
import { compactExperimentStatus } from "@/lib/experiments";

import { jsonError } from "../../_lib/http";

export const dynamic = "force-dynamic";

function bearer(request: Request): string {
  return (
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    ""
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const experiment = await experimentRepository.get(id, bearer(request));
  if (!experiment) return jsonError(404, "Experiment not found");
  return Response.json(compactExperimentStatus(experiment), {
    headers: { "cache-control": "no-store, private" },
  });
}

