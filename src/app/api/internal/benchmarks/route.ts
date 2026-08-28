import { z } from "zod";

import { runnerAuthorized } from "@/app/api/_server/runner-auth";
import { dispatchExperiment } from "@/app/api/_server/dispatch-experiment";
import { CANONICAL_SAFETY_SUITE } from "@/lib/canonical-contract";
import { experimentQueueConfigured } from "@/lib/experiment-queue";
import { experimentRepository } from "@/lib/experiment-repository";

import { jsonError, messageFromUnknown, readJsonBody } from "../../_lib/http";

export const dynamic = "force-dynamic";

const BenchmarkRequestSchema = z
  .object({
    seeds: z
      .array(z.number().int().min(0).max(2_147_483_647))
      .min(1)
      .max(10)
      .refine((seeds) => new Set(seeds).size === seeds.length, {
        message: "Benchmark seeds must be unique",
      }),
  })
  .strict();

export async function POST(request: Request) {
  if (!runnerAuthorized(request)) {
    return jsonError(401, "Runner authentication failed");
  }
  if (!experimentQueueConfigured()) {
    return jsonError(503, "Browser-native experiment queue is not configured");
  }
  try {
    const { seeds } = BenchmarkRequestSchema.parse(await readJsonBody(request));
    const runs = [];
    const failedSeeds = [];
    for (const seed of seeds) {
      try {
        const created = await experimentRepository.create(CANONICAL_SAFETY_SUITE, {
          seed,
        });
        const dispatch = await dispatchExperiment(created.experiment.id);
        runs.push({
          id: created.experiment.id,
          seed,
          accessToken: created.accessToken,
          receiptToken: created.receiptToken,
          dispatch,
          statusPath: `/api/experiments/${created.experiment.id}`,
          receiptPath: `/api/receipts/${created.receiptToken}`,
        });
      } catch (error) {
        failedSeeds.push({ seed, error: messageFromUnknown(error).slice(0, 500) });
      }
    }
    return Response.json(
      { runs, failedSeeds },
      { status: 202, headers: { "cache-control": "no-store, private" } },
    );
  } catch (error) {
    return jsonError(400, messageFromUnknown(error));
  }
}
