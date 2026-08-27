import { ensureSharedRunReport } from "@/lib/run-report";

import { jsonError } from "../../../_lib/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const report = await ensureSharedRunReport(id, request.url);
  if (!report) return jsonError(404, "Run not found");

  return Response.json(
    report,
    {
      status: 201,
      headers: { "cache-control": "no-store, private" },
    },
  );
}
