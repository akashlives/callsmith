import { runStore } from "@/lib/run-store";

import { jsonError } from "../../_lib/http";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = await runStore.getPersistent(id);
  if (!run) return jsonError(404, "Run not found");
  const requestedShareToken = new URL(request.url).searchParams.get("shareToken");
  if (requestedShareToken && requestedShareToken !== run.shareToken) {
    return jsonError(404, "Run not found");
  }

  return Response.json(run, {
    headers: { "cache-control": "no-store, private" },
  });
}
