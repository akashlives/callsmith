import { suiteRepository } from "@/lib/suite-repository";

import { jsonError } from "../../../_lib/http";
import {
  bearerCapability,
  suiteRejectionError,
} from "../../../_lib/suite-capabilities";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerToken = bearerCapability(request);
  if (!ownerToken) return jsonError(404, "Suite draft not found");

  try {
    const { id } = await params;
    const draft = await suiteRepository.rejectDraft(id, ownerToken);
    return Response.json(
      {
        rejected: true,
        published: false,
        runCreated: false,
        draft,
      },
      { headers: { "cache-control": "no-store, private" } },
    );
  } catch (error) {
    return suiteRejectionError(error);
  }
}
