import { z } from "zod";

import {
  AssertionResultSchema,
  ContractVariantSchema,
  JsonObjectSchema,
  JsonValueSchema,
  NormalizedTraceEventSchema,
} from "@/lib/contracts";

export const ReceiptTaskOutcomeSchema = z.enum([
  "completed",
  "pending_human",
  "incomplete",
  "unknown",
]);
export const ReceiptUnsafeActionSchema = z.enum(["attempted", "not_attempted"]);
export const ReceiptProtectedStateSchema = z.enum([
  "preserved",
  "mutated",
  "unknown",
]);
export const ReceiptHarmPreventionSchema = z.enum([
  "prevented",
  "failed",
  "not_exercised",
]);
export const ReceiptBaselineOutcomeSchema = z.enum(["pass", "fail", "error"]);
export const ReceiptConclusionSchema = z.enum([
  "hardened_prevented_harm",
  "no_unsafe_attempt",
  "both_mutated",
  "no_material_difference",
  "inconclusive",
]);

export const ReceiptFactsSchema = z
  .object({
    taskOutcome: ReceiptTaskOutcomeSchema,
    unsafeAction: ReceiptUnsafeActionSchema,
    protectedState: ReceiptProtectedStateSchema,
    harmPrevention: ReceiptHarmPreventionSchema,
    officialExpectedCallBaseline: ReceiptBaselineOutcomeSchema,
  })
  .strict();

export const ReceiptAttemptEvidenceSchema = z
  .object({
    attemptId: z.string().min(1),
    contractVariant: ContractVariantSchema,
    facts: ReceiptFactsSchema,
    trace: z.array(NormalizedTraceEventSchema),
    stateChanges: z.array(
      z
        .object({
          sequence: z.number().int().min(0),
          toolName: z.string().min(1).optional(),
          before: JsonObjectSchema.optional(),
          after: JsonObjectSchema.optional(),
        })
        .strict(),
    ),
    finalState: JsonObjectSchema,
    assertions: z.array(AssertionResultSchema),
    failures: z.array(z.string()),
    finalResponse: z.string(),
    latencyMs: z.number().int().min(0),
    usage: z
      .object({
        inputTokens: z.number().int().min(0),
        outputTokens: z.number().int().min(0),
        estimatedCostUsd: z.number().min(0),
      })
      .strict()
      .optional(),
    execution: z
      .object({
        browserVersion: z.string().min(1),
        webMcpRunner: z.string().min(1),
        webMcpRunnerVersion: z.string().min(1),
        model: z.string().min(1),
        backend: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const ContractDiffSchema = z
  .object({
    untrustedContentTool: z.string().min(1),
    consequentialMutationTool: z.string().min(1),
    weak: z
      .object({
        untrustedContentHint: z.literal(false),
        destructiveHint: z.literal(false),
        requiresConfirmation: z.literal(false),
      })
      .strict(),
    hardened: z
      .object({
        untrustedContentHint: z.literal(true),
        destructiveHint: z.literal(true),
        requiresConfirmation: z.literal(true),
      })
      .strict(),
  })
  .strict();

export const EvidenceReceiptV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    receiptId: z.string().min(1),
    experimentId: z.string().min(1),
    finalizedAt: z.string().datetime(),
    contract: z
      .object({
        id: z.string().min(1),
        version: z.string().min(1),
        title: z.string().min(1),
        protectedStatePath: z.string().min(1),
        safeValue: JsonValueSchema,
        unsafeValue: JsonValueSchema,
      })
      .strict(),
    prompt: z.string().min(1),
    seed: z.number().int(),
    contractDiff: ContractDiffSchema,
    weak: ReceiptAttemptEvidenceSchema.extend({
      contractVariant: z.literal("weak"),
    }),
    hardened: ReceiptAttemptEvidenceSchema.extend({
      contractVariant: z.literal("hardened"),
    }),
    conclusion: ReceiptConclusionSchema,
    coverage: z
      .object({
        expectedPairs: z.number().int().min(1),
        completedPairs: z.number().int().min(1),
      })
      .strict(),
    framework: z
      .object({
        nodeVersion: z.string().min(1),
        applicationRevision: z.string().min(1),
        frameworkManifestRevision: z.string().min(1),
      })
      .strict(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type ReceiptTaskOutcome = z.infer<typeof ReceiptTaskOutcomeSchema>;
export type ReceiptFacts = z.infer<typeof ReceiptFactsSchema>;
export type ReceiptAttemptEvidence = z.infer<typeof ReceiptAttemptEvidenceSchema>;
export type ReceiptConclusion = z.infer<typeof ReceiptConclusionSchema>;
export type EvidenceReceiptV1 = z.infer<typeof EvidenceReceiptV1Schema>;

