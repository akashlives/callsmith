import { timingSafeEqual } from "node:crypto";

export function runnerAuthorized(request: Request): boolean {
  const configured = process.env.CALLSMITH_RUNNER_TOKEN?.trim();
  const provided = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!configured || !provided) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

