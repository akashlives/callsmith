import { jsonError, messageFromUnknown, readJsonBody } from "../../_lib/http";
import {
  SuiteAuthoringError,
  validateSuiteAuthoringInput,
} from "../../_lib/suite-authoring";

export async function POST(request: Request) {
  try {
    const result = validateSuiteAuthoringInput(await readJsonBody(request));

    return Response.json(
      { valid: true, suite: result.suite, source: result.source },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SuiteAuthoringError) {
      return jsonError(422, "Suite definition is invalid", error.issues);
    }
    return jsonError(400, messageFromUnknown(error));
  }
}
