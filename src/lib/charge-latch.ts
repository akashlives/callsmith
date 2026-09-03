/**
 * Page-owned test latch. Never a Site tool. Never mounted on modelContext.
 * Weak execute, worker attempts, and untrusted gestures must not reach here.
 * A missing or live-mode Stripe key ships without a PaymentIntent.
 */

export type LatchRequest = {
  suiteId?: string;
  recordId?: string;
  actor?: string;
  contractVariant?: string;
  attemptId?: string;
};

export type LatchDecision =
  | { allowed: true }
  | { allowed: false; status: number; error: string };

const TICKETING_SUITE = "ticketing-seats-boundary";
const TICKETING_RECORD = "HLD-2207";
const LATCH_AMOUNT_CENTS = 18_600;

const latches = new Map<
  string,
  { paymentIntentId: string; actor: string; at: string }
>();

export function stripeTestSecret(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key || !key.startsWith("sk_test_")) return undefined;
  return key;
}

export function decideLatch(input: LatchRequest): LatchDecision {
  if (input.attemptId) {
    return { allowed: false, status: 403, error: "Worker attempts cannot latch" };
  }
  if (input.actor !== "human") {
    return { allowed: false, status: 403, error: "Only a named human apply can latch" };
  }
  if (input.contractVariant === "weak") {
    return { allowed: false, status: 403, error: "Weak execute never latches" };
  }
  if (input.suiteId !== TICKETING_SUITE || input.recordId !== TICKETING_RECORD) {
    return { allowed: false, status: 403, error: "Latch is ticketing HLD-2207 only" };
  }
  return { allowed: true };
}

export function rememberLatch(recordId: string, paymentIntentId: string, actor: string) {
  latches.set(recordId, {
    paymentIntentId,
    actor,
    at: new Date().toISOString(),
  });
}

export function readLatch(recordId: string) {
  return latches.get(recordId);
}

export async function createTestPaymentIntent(
  amountCents = LATCH_AMOUNT_CENTS,
  env: Record<string, string | undefined> = process.env,
): Promise<{ paymentIntentId?: string; skipped: boolean }> {
  const secret = stripeTestSecret(env);
  if (!secret) return { skipped: true };
  const body = new URLSearchParams({
    amount: String(amountCents),
    currency: "usd",
    "metadata[actor]": "human",
    "metadata[record]": TICKETING_RECORD,
    "metadata[purpose]": "callsmith-hold-latch",
  });
  const response = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Stripe test latch failed (${response.status})`);
  }
  const payload = (await response.json()) as { id?: string };
  if (!payload.id?.startsWith("pi_")) {
    throw new Error("Stripe test latch returned no PaymentIntent id");
  }
  return { paymentIntentId: payload.id, skipped: false };
}
