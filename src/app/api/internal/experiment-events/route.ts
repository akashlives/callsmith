import { z } from "zod";

import { runnerAuthorized } from "@/app/api/_server/runner-auth";
import {
  attemptFromBrowserReport,
  failedAttemptFromBrowser,
} from "@/lib/browser-evidence";
import { ContractVariantSchema } from "@/lib/contracts";
import {
  buildEvidenceReceiptFromExperiment,
} from "@/lib/evidence-receipt-server";
import { experimentRepository } from "@/lib/experiment-repository";
import { publishExperimentEvent } from "@/lib/experiment-queue";
import { frameworkManifest } from "@/lib/framework-manifest";
import { suiteForContract } from "@/lib/suites";

import { jsonError, messageFromUnknown, readJsonBody } from "../../_lib/http";

export const dynamic = "force-dynamic";

const RunnerIdentitySchema = z
  .object({ name: z.literal("webmcp-evals"), version: z.string().min(1) })
  .strict();

const AttemptBaseSchema = z.object({
  experimentId: z.string().min(1),
  contractVariant: ContractVariantSchema,
});

const WorkerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("started"), experimentId: z.string().min(1) }).strict(),
  AttemptBaseSchema.extend({ type: z.literal("attempt_started") }).strict(),
  AttemptBaseSchema.extend({
    type: z.literal("attempt"),
    browserVersion: z.string().min(1),
    sandboxUrl: z.string().url(),
    latencyMs: z.number().int().min(0),
    webMcpRunner: RunnerIdentitySchema,
    modelBackend: z.string().min(1),
    report: z.unknown(),
    finalScreenshot: z.string().max(3_500_000).optional(),
  }).strict(),
  AttemptBaseSchema.extend({
    type: z.literal("failure"),
    browserVersion: z.string().min(1).optional(),
    sandboxUrl: z.string().url().optional(),
    latencyMs: z.number().int().min(0),
    webMcpRunner: RunnerIdentitySchema,
    modelBackend: z.string().min(1),
    error: z.string().min(1).max(2_000),
  }).strict(),
  z.object({ type: z.literal("completed"), experimentId: z.string().min(1) }).strict(),
]);

async function finalize(experimentId: string) {
  const current = await experimentRepository.getInternal(experimentId);
  const suite = await experimentRepository.getSuite(experimentId);
  if (!current || !suite) throw new Error("Experiment is no longer available");
  const completed = current.attempts.filter((attempt) => attempt.status === "completed").length;
  const failures = current.attempts.filter(
    (attempt) => attempt.status === "provider_failure",
  ).length;
  const status =
    completed === 2
      ? "completed"
      : completed > 0
        ? "partial_failure"
        : failures > 0
          ? "failed"
          : "failed";
  const terminal = await experimentRepository.setStatus(experimentId, status);
  if (terminal.evidenceStatus === "conclusive") {
    const manifest = await frameworkManifest();
    const receipt = buildEvidenceReceiptFromExperiment({
      experiment: terminal,
      suite,
      framework: {
        nodeVersion: manifest.node,
        applicationRevision: manifest.applicationRevision,
        frameworkManifestRevision: manifest.revision,
      },
    });
    await experimentRepository.finalizeReceipt(experimentId, receipt);
  }
  const finalized = await experimentRepository.getInternal(experimentId);
  if (!finalized) throw new Error("Experiment disappeared during finalization");
  await publishExperimentEvent({
    type: "completed",
    experimentId,
    at: new Date().toISOString(),
    evidenceStatus: finalized.evidenceStatus,
    receiptAvailable: Boolean(finalized.receiptId),
  });
  return finalized;
}

export async function POST(request: Request) {
  if (!runnerAuthorized(request)) return jsonError(401, "Runner authentication failed");
  try {
    const event = WorkerEventSchema.parse(await readJsonBody(request));
    const experiment = await experimentRepository.getInternal(event.experimentId);
    const suite = await experimentRepository.getSuite(event.experimentId);
    if (!experiment || !suite) return jsonError(404, "Experiment not found");
    if (event.type === "started") {
      const updated = await experimentRepository.setStatus(experiment.id, "running");
      await publishExperimentEvent({
        type: "started",
        experimentId: experiment.id,
        at: new Date().toISOString(),
        evidenceStatus: updated.evidenceStatus,
      });
      return Response.json({ accepted: true, status: updated.status });
    }
    if (event.type === "attempt_started") {
      await publishExperimentEvent({
        type: "attempt_started",
        experimentId: experiment.id,
        contractVariant: event.contractVariant,
        at: new Date().toISOString(),
      });
      return Response.json({ accepted: true });
    }
    if (event.type === "completed") {
      const finalized = await finalize(experiment.id);
      return Response.json({
        accepted: true,
        status: finalized.status,
        evidenceStatus: finalized.evidenceStatus,
        receiptAvailable: Boolean(finalized.receiptId),
      });
    }

    const contractedSuite = suiteForContract(suite, event.contractVariant);
    const contractedScenario = contractedSuite.scenarios[0];
    const attempt =
      event.type === "attempt"
        ? attemptFromBrowserReport({
            experimentId: experiment.id,
            suite: contractedSuite,
            scenario: contractedScenario,
            seed: experiment.seed,
            contractVariant: event.contractVariant,
            browserVersion: event.browserVersion,
            sandboxUrl: event.sandboxUrl,
            latencyMs: event.latencyMs,
            runner: event.webMcpRunner,
            modelBackend: event.modelBackend,
            report: event.report,
          })
        : failedAttemptFromBrowser({
            experimentId: experiment.id,
            suite: contractedSuite,
            seed: experiment.seed,
            contractVariant: event.contractVariant,
            browserVersion: event.browserVersion,
            latencyMs: event.latencyMs,
            runner: event.webMcpRunner,
            modelBackend: event.modelBackend,
            error: event.error,
          });
    const inserted = await experimentRepository.addAttempt(experiment.id, attempt);
    if (event.type === "attempt" && event.finalScreenshot) {
      try {
        await experimentRepository.addFrame({
          experimentId: experiment.id,
          contractVariant: event.contractVariant,
          stepIndex: 0,
          at: new Date().toISOString(),
          toolCalls: [],
          screenshot: event.finalScreenshot,
        });
      } catch {
        // Frames sit beside the hash. A missing JPEG must not fail the pair.
      }
    }
    await publishExperimentEvent({
      type:
        attempt.status === "completed" ? "attempt_completed" : "attempt_failed",
      experimentId: experiment.id,
      contractVariant: event.contractVariant,
      at: new Date().toISOString(),
      message:
        attempt.status === "completed"
          ? "Browser-native evidence recorded."
          : attempt.failure,
    });
    return Response.json({ accepted: true, inserted, attemptId: attempt.attemptId });
  } catch (error) {
    return jsonError(400, messageFromUnknown(error));
  }
}
