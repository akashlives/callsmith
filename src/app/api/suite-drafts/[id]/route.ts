import { suiteRepository } from "@/lib/suite-repository";

import { jsonError } from "../../_lib/http";
import { bearerCapability } from "../../_lib/suite-capabilities";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerToken = bearerCapability(request);
  const { id } = await params;
  if (!ownerToken) return jsonError(404, "Suite draft not found");

  const draft = await suiteRepository.getDraft(id, ownerToken);
  if (!draft) return jsonError(404, "Suite draft not found");
  return Response.json(
    { draft },
    { headers: { "cache-control": "no-store, private" } },
  );
}
