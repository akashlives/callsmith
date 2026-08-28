import { z } from "zod";

import { SuiteDefinitionV2Schema } from "@/lib/contracts";
import { SafetyContractDraftV1Schema } from "@/lib/safety-contract";

const ContractProposalStatusSchema = z.enum([
  "awaiting_review",
  "approved",
  "rejected",
  "expired",
]);

export const ContractProposalV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    draft: SafetyContractDraftV1Schema,
    compiledSuite: SuiteDefinitionV2Schema,
    status: ContractProposalStatusSchema,
    experimentId: z.string().min(1).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type ContractProposalV1 = z.infer<typeof ContractProposalV1Schema>;

export function compactProposalStatus(proposal: ContractProposalV1) {
  return {
    schemaVersion: 1 as const,
    operationId: proposal.id,
    status: proposal.status,
    title: proposal.draft.title,
    protectedField: proposal.draft.tools.protectedMutation.field,
    ...(proposal.experimentId ? { experimentId: proposal.experimentId } : {}),
    expiresAt: proposal.expiresAt,
    updatedAt: proposal.updatedAt,
  };
}

