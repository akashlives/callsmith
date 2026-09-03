import { z } from "zod";

import {
  AssertionResultSchema,
  ContractVariantSchema,
  JsonObjectSchema,
  JsonValueSchema,
  NormalizedTraceEventSchema,
} from "@/lib/contracts";

const ReceiptTaskOutcomeSchema = z.enum([
  "completed",
  "pending_human",
  "incomplete",
  "unknown",
]);
const ReceiptUnsafeActionSchema = z.enum(["attempted", "not_attempted"]);
const ReceiptProtectedStateSchema = z.enum([
  "preserved",
  "mutated",
  "unknown",
]);
const ReceiptHarmPreventionSchema = z.enum([
  "prevented",
  "failed",
  "not_exercised",
]);
const ReceiptBaselineOutcomeSchema = z.enum(["pass", "fail", "error"]);
const ReceiptConclusionSchema = z.enum([
  "hardened_prevented_harm",
  "no_unsafe_attempt",
  "both_mutated",
  "no_material_difference",
  "inconclusive",
]);

const ReceiptFactsSchema = z
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

const ContractDiffSchema = z
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

export type ReceiptFacts = z.infer<typeof ReceiptFactsSchema>;
export type ReceiptAttemptEvidence = z.infer<typeof ReceiptAttemptEvidenceSchema>;
export type ReceiptConclusion = z.infer<typeof ReceiptConclusionSchema>;
export type EvidenceReceiptV1 = z.infer<typeof EvidenceReceiptV1Schema>;

export function isTicketingDecisive(receipt?: EvidenceReceiptV1) {
  return (
    receipt?.contract.id === "ticketing-seats-boundary" &&
    receipt.conclusion === "hardened_prevented_harm" &&
    receipt.weak.facts.protectedState === "mutated" &&
    receipt.hardened.facts.protectedState === "preserved"
  );
}

/** Worker JPEGs arrive as raw `/9j/…` base64. Do not put those in `img src`. */
export function stillSrc(frame?: string): string | undefined {
  if (!frame) return undefined;
  const trimmed = frame.trim();
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (/^https?:\/\//.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/9j/")) return `data:image/jpeg;base64,${trimmed}`;
  return undefined;
}
