import { z } from "zod";

import { CANONICAL_SAFETY_SUITE } from "@/lib/canonical-contract";
import { getSuite } from "@/lib/suites";
import { experimentRepository } from "@/lib/experiment-repository";
import {
  experimentQueueConfigured,
} from "@/lib/experiment-queue";
import { compactExperimentStatus } from "@/lib/experiments";

import { jsonError, messageFromUnknown, readJsonBody } from "../_lib/http";
import { dispatchExperiment } from "../_server/dispatch-experiment";

const StartExperimentSchema = z
  .object({
    suiteId: z.string().min(1).optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const body = StartExperimentSchema.parse(await readJsonBody(request));
    if (!experimentQueueConfigured()) {
      return jsonError(503, "Browser-native experiment queue is not configured", {
        code: "BROWSER_QUEUE_REQUIRED",
        action: "Configure Redis and the Callsmith browser worker. No fallback evidence was substituted.",
      });
    }
    const suite = body.suiteId ? getSuite(body.suiteId) : CANONICAL_SAFETY_SUITE;
    if (!suite) {
      return jsonError(404, `Unknown suite \"${body.suiteId}\"`);
    }
    const created = await experimentRepository.create(suite);
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
