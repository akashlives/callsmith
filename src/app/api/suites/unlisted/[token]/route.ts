import { suiteRepository } from "@/lib/suite-repository";
import { migrateSuiteDefinition } from "@/lib/suite-compiler";

import { jsonError } from "../../../_lib/http";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const published = await suiteRepository.resolveSuite(token);
  if (!published) return jsonError(404, "Suite not found");
  const suite = migrateSuiteDefinition(published.definition);

  return Response.json(
    {
      suite,
      publishedAt: published.publishedAt,
      immutable: true,
    },
    { headers: { "cache-control": "no-store, private" } },
  );
}
