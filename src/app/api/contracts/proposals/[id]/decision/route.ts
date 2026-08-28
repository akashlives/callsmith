import { z } from "zod";

import { contractProposalRepository } from "@/lib/contract-proposal-repository";
import { compactProposalStatus } from "@/lib/contract-proposals";
import { experimentRepository } from "@/lib/experiment-repository";
import {
  experimentQueueConfigured,
} from "@/lib/experiment-queue";
import { compactExperimentStatus } from "@/lib/experiments";

import { jsonError, messageFromUnknown, readJsonBody } from "../../../../_lib/http";
import { dispatchExperiment } from "../../../../_server/dispatch-experiment";

const DecisionSchema = z.object({ decision: z.enum(["approve", "reject"]) }).strict();

function bearer(request: Request): string {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { decision } = DecisionSchema.parse(await readJsonBody(request));
    if (decision === "approve" && !experimentQueueConfigured()) {
      return jsonError(503, "Browser-native experiment queue is not configured");
    }
    const decided = await contractProposalRepository.decide(
      id,
      bearer(request),
      decision,
    );
    if (decision === "reject") {
      return Response.json(
        { operation: compactProposalStatus(decided), experiment: null },
        { headers: { "cache-control": "no-store, private" } },
      );
    }

    const created = await experimentRepository.create(decided.compiledSuite);
    const attached = await contractProposalRepository.attachExperiment(
      decided.id,
      created.experiment.id,
    );
    const dispatch = await dispatchExperiment(created.experiment.id);
    return Response.json(
      {
        operation: compactProposalStatus(attached),
        experiment: compactExperimentStatus(created.experiment),
        dispatch,
        privateCapabilities: {
          accessToken: created.accessToken,
          receiptToken: created.receiptToken,
        },
        links: {
          status: `/api/experiments/${created.experiment.id}`,
          events: `/api/experiments/${created.experiment.id}/events`,
          receipt: `/r/${created.receiptToken}`,
        },
      },
      { status: 202, headers: { "cache-control": "no-store, private" } },
    );
  } catch (error) {
    return jsonError(409, messageFromUnknown(error));
  }
}
