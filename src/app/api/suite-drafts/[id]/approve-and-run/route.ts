import { suiteRepository } from "@/lib/suite-repository";
import { ensureSharedRunReport, type SharedRunReport } from "@/lib/run-report";

import { readJsonBody } from "../../../_lib/http";
import {
  bearerCapability,
  confirmationCapability,
  suiteRepositoryError,
} from "../../../_lib/suite-capabilities";
import { POST as createRun } from "../../../runs/route";

type RunOptions = {
  scenarioId?: unknown;
  models?: unknown;
  repetitions?: unknown;
  seed?: unknown;
  provenance?: unknown;
  contractVariants?: unknown;
  apiKey?: unknown;
};

function runOptions(input: unknown): RunOptions {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const run = (input as Record<string, unknown>).run;
  return run && typeof run === "object" && !Array.isArray(run)
    ? (run as RunOptions)
    : {};
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ownerToken = bearerCapability(request) ?? "";
    const confirmationToken = confirmationCapability(request) ?? "";
    const { id } = await params;
    const options = runOptions(await readJsonBody(request));
    const published = await suiteRepository.approveDraft(
      id,
      ownerToken,
      confirmationToken,
    );
    const scenario = published.suite.definition.scenarios.find(
      (candidate) => candidate.id === options.scenarioId,
    ) ?? published.suite.definition.scenarios[0];

    const internalRequest = new Request(new URL("/api/runs", request.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        suiteId: published.suite.suiteId,
        suiteVersion: published.suite.suiteVersion,
        suiteCapabilityToken: published.capabilityToken,
        scenarioId: scenario.id,
        models: options.models,
        repetitions: options.repetitions,
        seed: options.seed,
        provenance: options.provenance,
        contractVariants: options.contractVariants,
        apiKey: options.apiKey,
      }),
    });
    const runResponse = await createRun(internalRequest);
    const run: unknown = await runResponse.json();
    let report: SharedRunReport | { available: false; error: string } | undefined;
    if (runResponse.ok && run && typeof run === "object" && "id" in run) {
      const runId = (run as { id?: unknown }).id;
      if (typeof runId === "string") {
        try {
          report =
            (await ensureSharedRunReport(runId, request.url)) ??
            {
              available: false,
              error: "The run started but its report capability is unavailable.",
            };
        } catch {
          report = {
            available: false,
            error: "The run started but its report capability could not be persisted.",
          };
        }
      }
    }

    return Response.json(
      {
        published: true,
        suite: {
          id: published.suite.suiteId,
          version: published.suite.suiteVersion,
          publishedAt: published.suite.publishedAt,
          immutable: true,
          capabilityToken: published.capabilityToken,
          url: `/api/suites/unlisted/${published.capabilityToken}`,
        },
        run,
        ...(report ? { report } : {}),
      },
      {
        status: runResponse.ok ? 202 : runResponse.status,
        headers: { "cache-control": "no-store, private" },
      },
    );
  } catch (error) {
    return suiteRepositoryError(error);
  }
}
