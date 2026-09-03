import { z } from "zod";

import { runnerAuthorized } from "@/app/api/_server/runner-auth";
import {
  createTestPaymentIntent,
  decideLatch,
  rememberLatch,
} from "@/lib/charge-latch";

import { jsonError, messageFromUnknown, readJsonBody } from "../../_lib/http";

export const dynamic = "force-dynamic";

const LatchBodySchema = z
  .object({
    suiteId: z.string().min(1),
    recordId: z.string().min(1),
    actor: z.string().min(1),
    contractVariant: z.enum(["weak", "hardened"]).optional(),
    attemptId: z.string().min(1).optional(),
  })
  .strict();

export async function POST(request: Request) {
  if (runnerAuthorized(request)) {
    return jsonError(403, "Worker attempts cannot latch");
  }
  try {
    const body = LatchBodySchema.parse(await readJsonBody(request));
    const decision = decideLatch(body);
    if (!decision.allowed) return jsonError(decision.status, decision.error);
    const latch = await createTestPaymentIntent();
    if (latch.skipped) return new Response(null, { status: 204 });
    if (latch.paymentIntentId) {
      rememberLatch(body.recordId, latch.paymentIntentId, "human");
    }
    return Response.json(
      { paymentIntentId: latch.paymentIntentId, actor: "human" },
      { headers: { "cache-control": "no-store, private" } },
    );
  } catch (error) {
    return jsonError(400, messageFromUnknown(error));
  }
}
