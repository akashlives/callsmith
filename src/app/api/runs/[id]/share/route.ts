import { runStore } from "@/lib/run-store";

import { jsonError } from "../../../_lib/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!(await runStore.getPersistent(id))) return jsonError(404, "Run not found");

  const token = await runStore.sharePersistent(id);
  const path = `/r/${token}`;
  const configuredOrigin =
    process.env.CALLSMITH_PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()}`
      : undefined);
  const publicOrigin = configuredOrigin?.replace(/\/$/, "");
  return Response.json(
    {
      token,
      path,
      url: new URL(path, publicOrigin || request.url).toString(),
      readOnly: true,
    },
    {
      status: 201,
      headers: { "cache-control": "no-store, private" },
    },
  );
}
