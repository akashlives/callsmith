import { z } from "zod";

import { CANONICAL_SAFETY_SUITE } from "@/lib/canonical-contract";
import { experimentRepository } from "@/lib/experiment-repository";
import {
  experimentQueueConfigured,
} from "@/lib/experiment-queue";
import { compactExperimentStatus } from "@/lib/experiments";

import { jsonError, messageFromUnknown, readJsonBody } from "../_lib/http";
import { dispatchExperiment } from "../_server/dispatch-experiment";

const StartExperimentSchema = z.object({}).strict();

export async function POST(request: Request) {
  try {
    StartExperimentSchema.parse(await readJsonBody(request));
    if (!experimentQueueConfigured()) {
      return jsonError(503, "Browser-native experiment queue is not configured", {
        code: "BROWSER_QUEUE_REQUIRED",
        action: "Configure Redis and the Callsmith browser worker. No fallback evidence was substituted.",
      });
    }
    const created = await experimentRepository.create(CANONICAL_SAFETY_SUITE);
    const dispatch = await dispatchExperiment(created.experiment.id);
    return Response.json(
      {
        experiment: compactExperimentStatus(created.experiment),
        accessToken: created.accessToken,
        receiptToken: created.receiptToken,
        dispatch,
        links: {
          status: `/api/experiments/${created.experiment.id}`,
          events: `/api/experiments/${created.experiment.id}/events`,
          receipt: `/r/${created.receiptToken}`,
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
