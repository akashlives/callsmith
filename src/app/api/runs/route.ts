import { CreateRunInputSchema, type ModelId } from "@/lib/contracts";
import { runStore } from "@/lib/run-store";
import { getScenario, getSuite } from "@/lib/suites";

import { jsonError, messageFromUnknown, readJsonBody } from "../_lib/http";
import { executeRun } from "../_server/execute-run";
import { claimGuestAttempts, guestIdentity } from "../_server/quota";

type RunRequest = {
  suiteId?: unknown;
  suiteVersion?: unknown;
  scenarioId?: unknown;
  models?: unknown;
  repetitions?: unknown;
  seed?: unknown;
  provenance?: unknown;
  apiKey?: unknown;
};

function objectBody(input: unknown): RunRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Run request must be a JSON object");
  }
  return input as RunRequest;
}

export async function POST(request: Request) {
  try {
    const body = objectBody(await readJsonBody(request));
    const suiteId = typeof body.suiteId === "string" ? body.suiteId : "";
    const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId : "";
    const suite = getSuite(suiteId);
    const scenario = getScenario(suiteId, scenarioId);
    if (!suite) return jsonError(404, "Suite not found");
    if (!scenario) return jsonError(404, "Scenario not found");
    if (body.suiteVersion !== undefined && body.suiteVersion !== suite.version) {
      return jsonError(409, "Suite version does not match the hosted definition", {
        requested: body.suiteVersion,
        available: suite.version,
      });
    }

    const provenance = body.provenance === "preview" ? "preview" : "model";
    const defaultModels: ModelId[] =
      provenance === "preview"
        ? ["gpt-5.6-luna", "gpt-5.6-terra"]
        : ["gpt-5.6-luna", "gpt-5.6-terra"];
    const parsed = CreateRunInputSchema.safeParse({
      suiteId,
      suiteVersion: suite.version,
      scenarioId,
      models: body.models ?? defaultModels,
      repetitions: body.repetitions ?? 1,
      seed: body.seed ?? scenario.seed,
      provenance,
    });
    if (!parsed.success) {
      return jsonError(
        422,
        "Run configuration is invalid",
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }
    if (parsed.data.repetitions > 3) {
      return jsonError(422, "Hosted comparisons allow at most three repetitions");
    }

    const byok = typeof body.apiKey === "string" && body.apiKey.trim()
      ? body.apiKey.trim()
      : undefined;
    const serverKey = process.env.OPENAI_API_KEY;
    if (parsed.data.provenance === "model" && !byok && !serverKey) {
      return jsonError(503, "Model runner is not configured", {
        code: "MODEL_KEY_REQUIRED",
        action:
          "Configure OPENAI_API_KEY or send a request-scoped apiKey. To inspect the UI without claiming a model run, set provenance to preview.",
        previewAvailable: true,
      });
    }

    // Deterministic preview evidence never calls a hosted model, so it must not
    // consume the limited guest model-attempt allowance.
    if (parsed.data.provenance === "model" && !byok) {
      const quota = claimGuestAttempts(
        guestIdentity(request),
        parsed.data.models.length * parsed.data.repetitions,
      );
      if (!quota.allowed) {
        return jsonError(429, "Guest model-attempt quota exceeded", quota);
      }
    }

    const run = runStore.create(parsed.data);
    // Railway runs a persistent Node process, allowing the request to return a
    // run id immediately while progress streams through the run store.
    void executeRun(run.id, parsed.data, byok ?? serverKey);

    return Response.json(
      {
        ...run,
        links: {
          self: `/api/runs/${run.id}`,
          events: `/api/runs/${run.id}/events`,
          sandbox: `/sandbox/${suite.id}/${scenario.id}`,
        },
      },
      {
        status: 202,
        headers: { "cache-control": "no-store, private" },
      },
    );
  } catch (error) {
    return jsonError(400, messageFromUnknown(error));
  }
}
