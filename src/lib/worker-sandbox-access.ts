import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_ACCESS_WINDOW_MS = 10 * 60 * 1_000;

function payload(runId: string, attemptId: string, expiresAtMs: number): string {
  return `${runId}\n${attemptId}\n${expiresAtMs}`;
}

function signatureBuffer(signature: string): Buffer | undefined {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return undefined;
  return Buffer.from(signature, "hex");
}

export function signWorkerSandboxAccess(
  runId: string,
  attemptId: string,
  expiresAtMs: number,
  secret: string,
): string {
  if (!runId || !attemptId || !secret || !Number.isSafeInteger(expiresAtMs)) {
    throw new TypeError("Worker sandbox access requires a run, attempt, expiry, and secret");
  }
  return createHmac("sha256", secret)
    .update(payload(runId, attemptId, expiresAtMs))
    .digest("hex");
}

export function verifyWorkerSandboxAccess(
  input: {
    runId: string;
    attemptId: string;
    expiresAtMs: number;
    signature: string;
  },
  secret: string,
  nowMs = Date.now(),
): boolean {
  if (
    !input.runId ||
    !input.attemptId ||
    !secret ||
    !Number.isSafeInteger(input.expiresAtMs) ||
    input.expiresAtMs < nowMs ||
    input.expiresAtMs > nowMs + MAX_ACCESS_WINDOW_MS
  ) {
    return false;
  }
  const provided = signatureBuffer(input.signature);
  if (!provided) return false;
  const expected = Buffer.from(
    signWorkerSandboxAccess(
      input.runId,
      input.attemptId,
      input.expiresAtMs,
      secret,
    ),
    "hex",
  );
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
