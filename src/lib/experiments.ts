import { z } from "zod";

import { ContractVariantSchema } from "@/lib/contracts";
import { ReceiptAttemptEvidenceSchema } from "@/lib/evidence-receipt";

export const CANONICAL_MODEL = "gpt-5.6-luna" as const;

const ExperimentStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "partial_failure",
  "failed",
]);

const ExperimentEvidenceStatusSchema = z.enum([
  "pending",
  "conclusive",
  "inconclusive",
  "provider_failure",
]);

export const CompletedExperimentAttemptSchema = ReceiptAttemptEvidenceSchema.extend({
  status: z.literal("completed"),
});

export const FailedExperimentAttemptSchema = z
  .object({
    attemptId: z.string().min(1),
    status: z.literal("provider_failure"),
    contractVariant: ContractVariantSchema,
    model: z.literal(CANONICAL_MODEL),
    seed: z.number().int(),
    failure: z.string().min(1).max(2_000),
    latencyMs: z.number().int().min(0),
    execution: z
      .object({
        browserVersion: z.string().min(1).optional(),
        webMcpRunner: z.string().min(1),
        webMcpRunnerVersion: z.string().min(1),
        backend: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const ExperimentAttemptV1Schema = z.discriminatedUnion("status", [
  CompletedExperimentAttemptSchema,
  FailedExperimentAttemptSchema,
]);

export const ExperimentRecordV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    contractId: z.string().min(1),
    contractVersion: z.string().min(1),
    model: z.literal(CANONICAL_MODEL),
    seed: z.number().int(),
    status: ExperimentStatusSchema,
    evidenceStatus: ExperimentEvidenceStatusSchema,
    attempts: z.array(ExperimentAttemptV1Schema),
    receiptId: z.string().min(1).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;
export type ExperimentEvidenceStatus = z.infer<
  typeof ExperimentEvidenceStatusSchema
>;
export type CompletedExperimentAttempt = z.infer<
  typeof CompletedExperimentAttemptSchema
>;
export type ExperimentAttemptV1 = z.infer<typeof ExperimentAttemptV1Schema>;
export type ExperimentRecordV1 = z.infer<typeof ExperimentRecordV1Schema>;

function hasCompletedVariant(
  attempts: ExperimentAttemptV1[],
  contractVariant: "weak" | "hardened",
): boolean {
  return attempts.some(
    (attempt) =>
      attempt.status === "completed" &&
      attempt.contractVariant === contractVariant,
  );
}

export function deriveExperimentEvidenceStatus(input: {
  status: ExperimentStatus;
  attempts: ExperimentAttemptV1[];
}): ExperimentEvidenceStatus {
  if (input.status === "queued" || input.status === "running") return "pending";
  if (
    hasCompletedVariant(input.attempts, "weak") &&
    hasCompletedVariant(input.attempts, "hardened")
  ) {
    return "conclusive";
  }
  if (
    input.attempts.length > 0 &&
    input.attempts.every((attempt) => attempt.status === "provider_failure")
  ) {
    return "provider_failure";
  }
  return "inconclusive";
}

export function compactExperimentStatus(experiment: ExperimentRecordV1) {
  return {
    schemaVersion: 1 as const,
    id: experiment.id,
    status: experiment.status,
    evidenceStatus: experiment.evidenceStatus,
    model: experiment.model,
    seed: experiment.seed,
    attempts: experiment.attempts.map((attempt) => ({
      contractVariant: attempt.contractVariant,
      status: attempt.status,
      ...(attempt.status === "completed" ? { facts: attempt.facts } : {}),
    })),
    receiptAvailable: Boolean(experiment.receiptId),
    updatedAt: experiment.updatedAt,
  };
}

export type CompactExperimentStatus = ReturnType<typeof compactExperimentStatus>;
