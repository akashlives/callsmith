import { timingSafeEqual } from "node:crypto";

import { CreateRunInputSchema, type ModelId } from "@/lib/contracts";
import { runStore } from "@/lib/run-store";
import { browserQueueConfigured, enqueueBrowserRun } from "@/lib/run-queue";
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
  contractVariants?: unknown;
  apiKey?: unknown;
};

function objectBody(input: unknown): RunRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Run request must be a JSON object");
  }
  return input as RunRequest;
}

function benchmarkAuthorized(request: Request): boolean {
  const configured = process.env.CALLSMITH_RUNNER_TOKEN?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!configured || !provided) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
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

    const provenance =
      body.provenance === "preview" || body.provenance === "deterministic_preview"
        ? "deterministic_preview"
        : body.provenance === "model" || body.provenance === "server_simulation"
          ? "server_simulation"
          : "browser_webmcp";
    const defaultModels: ModelId[] =
      provenance === "browser_webmcp"
        ? ["gpt-5.6-luna"]
        : ["gpt-5.6-luna", "gpt-5.6-terra"];
    const parsed = CreateRunInputSchema.safeParse({
      suiteId,
      suiteVersion: suite.version,
      scenarioId,
      models: body.models ?? defaultModels,
      repetitions: body.repetitions ?? 1,
      seed: body.seed ?? scenario.seed,
      provenance,
      contractVariants: body.contractVariants ?? ["weak", "hardened"],
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
    const authorizedBenchmark = benchmarkAuthorized(request);
    if (parsed.data.repetitions > 3 && !authorizedBenchmark) {
      return jsonError(
        422,
        "Guest comparisons allow at most three repetitions; immutable benchmarks require runner authorization",
      );
    }

    const byok = typeof body.apiKey === "string" && body.apiKey.trim()
      ? body.apiKey.trim()
      : undefined;
    const serverKey = process.env.OPENAI_API_KEY;
    if (parsed.data.provenance === "browser_webmcp" && byok) {
      return jsonError(422, "Request-scoped API keys are not accepted by the durable browser queue", {
        code: "BROWSER_BYOK_UNSUPPORTED",
        action:
          "Use the hosted browser runner or choose server_simulation for a request-scoped key.",
      });
    }
    if (parsed.data.provenance === "browser_webmcp" && !browserQueueConfigured()) {
      return jsonError(503, "Browser-native runner queue is not configured", {
        code: "BROWSER_QUEUE_REQUIRED",
        action:
          "Configure REDIS_URL and the Callsmith browser worker. No simulation result was substituted.",
      });
    }
    if (parsed.data.provenance === "server_simulation" && !byok && !serverKey) {
      return jsonError(503, "Model runner is not configured", {
        code: "MODEL_KEY_REQUIRED",
        action:
          "Configure OPENAI_API_KEY or send a request-scoped apiKey. To inspect the UI without claiming a model run, set provenance to deterministic_preview.",
        previewAvailable: true,
      });
    }

    // Deterministic preview evidence never calls a hosted model, so it must not
    // consume the limited guest model-attempt allowance.
    if (
      parsed.data.provenance !== "deterministic_preview" &&
      !byok &&
      !authorizedBenchmark
    ) {
      const quota = claimGuestAttempts(
        guestIdentity(request),
        parsed.data.models.length *
          parsed.data.contractVariants.length *
          parsed.data.repetitions,
      );
      if (!quota.allowed) {
        return jsonError(429, "Guest model-attempt quota exceeded", quota);
      }
    }

    const run = runStore.create(parsed.data);
    if (parsed.data.provenance === "browser_webmcp") {
      await enqueueBrowserRun(run.id, parsed.data);
    } else {
      // Simulation and deterministic preview remain synchronous process-local
      // fallbacks and are always labeled as such in the result contract.
      void executeRun(run.id, parsed.data, byok ?? serverKey);
    }

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
