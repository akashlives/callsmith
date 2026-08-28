import { experimentRepository } from "@/lib/experiment-repository";

import { jsonError } from "../../_lib/http";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const receipt = await experimentRepository.getReceipt(token);
  if (!receipt) return jsonError(404, "Evidence receipt not found");
  return Response.json(receipt, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-disposition": `attachment; filename="callsmith-${receipt.receiptId}.json"`,
      etag: `"sha256-${receipt.contentHash}"`,
    },
  });
}

