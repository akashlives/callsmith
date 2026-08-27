import { timingSafeEqual } from "node:crypto";

import { runStore } from "@/lib/run-store";
import { suiteRepository } from "@/lib/suite-repository";
import { getSuite } from "@/lib/suites";

import { jsonError } from "../../../../_lib/http";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!authorized(request)) return jsonError(401, "Runner authentication failed");
  const { id } = await params;
  const run = await runStore.getPersistent(id);
  if (!run) return jsonError(404, "Run not found");

  const registered = getSuite(run.suiteId);
  const suite =
    (registered?.version === run.suiteVersion ? registered : undefined) ??
    (await suiteRepository.getSuiteInternal(run.suiteId, run.suiteVersion))
      ?.definition;
  const scenario = suite?.scenarios.find(
    (candidate) => candidate.id === run.scenarioId,
  );
  if (!suite || !scenario) return jsonError(404, "Run suite not found");

  return Response.json(
    { suite, scenario },
    { headers: { "cache-control": "no-store, private" } },
  );
}
