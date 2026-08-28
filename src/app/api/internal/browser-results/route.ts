import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { attemptFromBrowserReport } from "@/lib/browser-evidence";
import { ContractVariantSchema, ModelIdSchema } from "@/lib/contracts";
import { createProviderFailureAttempt } from "@/lib/evaluation";
import { runStore } from "@/lib/run-store";
import { migrateSuiteDefinition } from "@/lib/suite-compiler";
import { suiteRepository } from "@/lib/suite-repository";
import { getSuite, suiteForContract } from "@/lib/suites";

import { jsonError, messageFromUnknown, readJsonBody } from "../../_lib/http";

export const dynamic = "force-dynamic";

const BaseEventSchema = z.object({
  runId: z.string().min(1),
});

const AttemptEventSchema = BaseEventSchema.extend({
  type: z.literal("attempt"),
  model: ModelIdSchema,
  seed: z.number().int(),
  contractVariant: ContractVariantSchema,
  browserVersion: z.string().min(1),
  sandboxUrl: z.string().url(),
  latencyMs: z.number().int().min(0),
  webMcpRunner: z
    .object({ name: z.literal("webmcp-evals"), version: z.string().min(1) })
    .strict(),
  modelBackend: z.string().min(1),
  browserConsole: z.array(z.unknown()).default([]),
  report: z.unknown(),
}).strict();

const FailureEventSchema = BaseEventSchema.extend({
  type: z.literal("failure"),
  model: ModelIdSchema,
  seed: z.number().int(),
  contractVariant: ContractVariantSchema,
  browserVersion: z.string().min(1).optional(),
  sandboxUrl: z.string().url().optional(),
  latencyMs: z.number().int().min(0),
  webMcpRunner: z
    .object({ name: z.literal("webmcp-evals"), version: z.string().min(1) })
    .strict(),
  modelBackend: z.string().min(1),
  error: z.string().min(1).max(2_000),
}).strict();

const WorkerEventSchema = z.discriminatedUnion("type", [
  BaseEventSchema.extend({ type: z.literal("started") }).strict(),
  AttemptEventSchema,
  FailureEventSchema,
  BaseEventSchema.extend({ type: z.literal("completed") }).strict(),
]);

function authorized(request: Request): boolean {
  const configured = process.env.CALLSMITH_RUNNER_TOKEN?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!configured || !provided) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: Request) {
  if (!authorized(request)) return jsonError(401, "Runner authentication failed");

  try {
    const event = WorkerEventSchema.parse(await readJsonBody(request));
    const run = await runStore.getPersistent(event.runId);
    if (!run) return jsonError(404, "Run not found");

    if (event.type === "started") {
      const updated = runStore.update(run.id, { status: "running" });
      return Response.json({
        accepted: true,
        status: updated.status,
        evidenceStatus: updated.evidenceStatus,
      });
    }

    if (event.type === "completed") {
      const current = runStore.get(run.id) ?? run;
      const expectedAttempts =
        current.models.length * current.contractVariants.length * current.repetitions;
      const failures = current.attempts.filter(
        (attempt) => attempt.status === "provider_failure",
      ).length;
      const status =
        current.attempts.length === 0 || failures === current.attempts.length
          ? "failed"
          : failures > 0 || current.attempts.length < expectedAttempts
            ? "partial_failure"
            : "completed";
      const updated = runStore.update(run.id, { status });
      return Response.json({
        accepted: true,
        status: updated.status,
        evidenceStatus: updated.evidenceStatus,
      });
    }

    const registered = getSuite(run.suiteId);
    const resolved =
      (registered?.version === run.suiteVersion ? registered : undefined) ??
      (await suiteRepository.getSuiteInternal(run.suiteId, run.suiteVersion))
        ?.definition;
    const suite = resolved ? migrateSuiteDefinition(resolved) : undefined;
    const scenario = suite?.scenarios.find(
      (candidate) => candidate.id === run.scenarioId,
    );
    if (!suite || !scenario) return jsonError(409, "Hosted suite is no longer available");
    const contractedSuite = suiteForContract(suite, event.contractVariant);
    const contractedScenario = contractedSuite.scenarios.find(
      (candidate) => candidate.id === scenario.id,
    );
    if (!contractedScenario) return jsonError(409, "Hosted scenario is no longer available");

    const attempt =
      event.type === "attempt"
        ? attemptFromBrowserReport({
            suite: contractedSuite,
            scenario: contractedScenario,
            model: event.model,
            seed: event.seed,
            contractVariant: event.contractVariant,
            browserVersion: event.browserVersion,
            sandboxUrl: event.sandboxUrl,
            latencyMs: event.latencyMs,
            runner: event.webMcpRunner,
            modelBackend: event.modelBackend,
            report: event.report,
          })
        : createProviderFailureAttempt(
            contractedSuite,
            contractedScenario,
            event.model,
            event.seed,
            event.error,
            event.latencyMs,
            {
              provenance: "browser_webmcp",
              contractVariant: event.contractVariant,
              executionMetadata: {
                ...(event.browserVersion
                  ? { browserVersion: event.browserVersion }
                  : {}),
                webMcpEngine: event.webMcpRunner.name,
                webMcpEngineVersion: event.webMcpRunner.version,
                modelBackend: event.modelBackend,
                model: event.model,
                suiteVersion: contractedSuite.version,
                seed: event.seed,
                contractVariant: event.contractVariant,
                ...(event.sandboxUrl ? { sandboxUrl: event.sandboxUrl } : {}),
              },
              trace: [
                {
                  sequence: 0,
                  type: "browser_execution_failure",
                  message: event.error,
                },
              ],
            },
          );
    const updated = runStore.appendAttempt(run.id, attempt);
    return Response.json({
      accepted: true,
      attemptId: attempt.id,
      attempts: updated.attempts.length,
      status: updated.status,
      evidenceStatus: updated.evidenceStatus,
    });
  } catch (error) {
    return jsonError(400, messageFromUnknown(error));
  }
}
