import { contractProposalRepository } from "@/lib/contract-proposal-repository";
import { compactProposalStatus } from "@/lib/contract-proposals";
import {
  SafetyContractError,
  type SafetyContractDraftV1,
} from "@/lib/safety-contract";

import { jsonError, messageFromUnknown, readJsonBody } from "../../_lib/http";

export async function POST(request: Request) {
  try {
    const created = await contractProposalRepository.create(
      (await readJsonBody(request)) as SafetyContractDraftV1,
    );
    return Response.json(
      {
        operation: compactProposalStatus(created.proposal),
        review: {
          draft: created.proposal.draft,
          protectedState: created.proposal.compiledSuite.contractDesign.protectedState,
          prompt: created.proposal.compiledSuite.scenarios[0].goal,
          expectedCalls: created.proposal.compiledSuite.scenarios[0].walkthroughs.success
            .filter((event) => event.type === "tool_call")
            .map((event) => ({ toolName: event.toolName, args: event.args })),
        },
        privateCapabilities: {
          ownerToken: created.ownerToken,
          decisionToken: created.decisionToken,
        },
        statusCapability: created.statusToken,
        links: {
          status: `/api/contracts/proposals/${created.proposal.id}/status`,
          decision: `/api/contracts/proposals/${created.proposal.id}/decision`,
        },
      },
      { status: 201, headers: { "cache-control": "no-store, private" } },
    );
  } catch (error) {
    return error instanceof SafetyContractError
      ? jsonError(422, "Safety contract is invalid", error.issues)
      : jsonError(400, messageFromUnknown(error));
  }
}

