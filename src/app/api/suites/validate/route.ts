import { validateSuite } from "@/lib/suites";

import { jsonError, messageFromUnknown, readJsonBody } from "../../_lib/http";

export async function POST(request: Request) {
  try {
    const result = validateSuite(await readJsonBody(request));
    if (!result.success) {
      return jsonError(422, "Suite definition is invalid", result.errors);
    }

    return Response.json(
      { valid: true, suite: result.data },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return jsonError(400, messageFromUnknown(error));
  }
}
