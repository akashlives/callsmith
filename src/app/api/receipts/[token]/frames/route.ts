import { experimentRepository } from "@/lib/experiment-repository";

import { jsonError } from "../../../_lib/http";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const receipt = await experimentRepository.getReceipt(token);
  if (!receipt) return jsonError(404, "Evidence receipt not found");
  const frames = await experimentRepository.listFrames(receipt.experimentId);
  const pair = Object.fromEntries(
    frames
      .filter((frame) => frame.screenshot)
      .map((frame) => [frame.contractVariant, frame.screenshot]),
  ) as { weak?: string; hardened?: string };
  return Response.json(
    {
      experimentId: receipt.experimentId,
      contractId: receipt.contract.id,
      frames: pair,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
