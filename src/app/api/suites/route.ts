import { listSuites, registerSuite, validateSuite } from "@/lib/suites";

import { jsonError, messageFromUnknown, readJsonBody } from "../_lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { suites: listSuites() },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    const input = await readJsonBody(request);
    const validation = validateSuite(input);
    if (!validation.success) {
      return jsonError(422, "Suite definition is invalid", validation.errors);
    }
    const suite = registerSuite(validation.data);
    return Response.json(
      {
        imported: true,
        suite,
        links: {
          sandbox: `/sandbox/${suite.id}/${suite.scenarios[0].id}`,
          runs: "/api/runs",
        },
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return jsonError(400, messageFromUnknown(error));
  }
}
