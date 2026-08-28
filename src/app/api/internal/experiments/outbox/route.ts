import { z } from "zod";

import { runnerAuthorized } from "@/app/api/_server/runner-auth";
import { experimentRepository } from "@/lib/experiment-repository";

import { jsonError, messageFromUnknown, readJsonBody } from "../../../_lib/http";

export const dynamic = "force-dynamic";

const DispatchedSchema = z.object({ experimentId: z.string().min(1) }).strict();

export async function GET(request: Request) {
  if (!runnerAuthorized(request)) {
    return jsonError(401, "Runner authentication failed");
  }
  return Response.json(
    { experimentIds: await experimentRepository.pendingDispatch() },
    { headers: { "cache-control": "no-store, private" } },
  );
}

export async function POST(request: Request) {
  if (!runnerAuthorized(request)) {
    return jsonError(401, "Runner authentication failed");
  }
  try {
    const { experimentId } = DispatchedSchema.parse(await readJsonBody(request));
    await experimentRepository.markDispatched(experimentId);
    return Response.json({ accepted: true });
  } catch (error) {
    return jsonError(400, messageFromUnknown(error));
  }
}
