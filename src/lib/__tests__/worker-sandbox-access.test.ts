import { describe, expect, it } from "vitest";

import {
  signWorkerSandboxAccess,
  verifyWorkerSandboxAccess,
} from "@/lib/worker-sandbox-access";

describe("worker sandbox access", () => {
  const secret = "runner-secret-for-tests";
  const now = Date.UTC(2026, 7, 27, 12, 0, 0);
  const input = {
    runId: "run-123",
    attemptId: "run-123-weak-gpt-5.6-luna-606",
    expiresAtMs: now + 5 * 60_000,
  };

  it("accepts only the exact short-lived run and attempt binding", () => {
    const signature = signWorkerSandboxAccess(
      input.runId,
      input.attemptId,
      input.expiresAtMs,
      secret,
    );
    expect(verifyWorkerSandboxAccess({ ...input, signature }, secret, now)).toBe(true);
    expect(
      verifyWorkerSandboxAccess(
        { ...input, runId: "run-other", signature },
        secret,
        now,
      ),
    ).toBe(false);
    expect(
      verifyWorkerSandboxAccess(
        { ...input, attemptId: `${input.attemptId}-other`, signature },
        secret,
        now,
      ),
    ).toBe(false);
  });

  it("rejects expired, excessively long, and malformed grants", () => {
    const signature = signWorkerSandboxAccess(
      input.runId,
      input.attemptId,
      input.expiresAtMs,
      secret,
    );
    expect(
      verifyWorkerSandboxAccess({ ...input, signature }, secret, input.expiresAtMs + 1),
    ).toBe(false);
    expect(
      verifyWorkerSandboxAccess(
        { ...input, expiresAtMs: now + 11 * 60_000, signature },
        secret,
        now,
      ),
    ).toBe(false);
    expect(
      verifyWorkerSandboxAccess({ ...input, signature: "not-a-signature" }, secret, now),
    ).toBe(false);
  });
});
