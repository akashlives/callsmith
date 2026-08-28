import { contractProposalRepository } from "@/lib/contract-proposal-repository";
import { compactProposalStatus } from "@/lib/contract-proposals";

import { jsonError } from "../../../../_lib/http";

export const dynamic = "force-dynamic";

function bearer(request: Request): string {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const proposal = await contractProposalRepository.getStatus(id, bearer(request));
  if (!proposal) return jsonError(404, "Contract proposal not found");
  return Response.json(compactProposalStatus(proposal), {
    headers: { "cache-control": "no-store, private" },
  });
}

