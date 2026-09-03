import { describe, expect, it, vi } from "vitest";

import { CANONICAL_SAFETY_SUITE, TICKETING_SAFETY_SUITE } from "@/lib/canonical-contract";
import {
  createTestPaymentIntent,
  decideLatch,
  readLatch,
  rememberLatch,
  stripeTestSecret,
} from "@/lib/charge-latch";
import {
  capabilityMatches,
  createCapabilityToken,
  hashCapabilityToken,
} from "@/lib/capabilities";
import {
  buildEvidenceReceiptFromExperiment,
} from "@/lib/evidence-receipt-server";
import { MemoryExperimentRepository } from "@/lib/experiment-repository";

import { completedAttemptFixture } from "./experiment-fixtures";

const framework = {
  nodeVersion: "24.20.0",
  applicationRevision: "test-revision",
  frameworkManifestRevision: "test-manifest",
};

describe("experiment repository", () => {
  it("uses opaque capabilities and keeps status reads private", async () => {
    const repository = new MemoryExperimentRepository();
    const created = await repository.create(CANONICAL_SAFETY_SUITE);

    expect(await repository.get(created.experiment.id, "wrong-token")).toBeUndefined();
    expect(
      await repository.get(created.experiment.id, created.accessToken),
    ).toMatchObject({ status: "queued", evidenceStatus: "pending" });
    expect(created.accessToken).not.toBe(created.receiptToken);
    expect(await repository.pendingDispatch()).toEqual([created.experiment.id]);
    await repository.markDispatched(created.experiment.id);
    expect(await repository.pendingDispatch()).toEqual([]);
  });

  it("deduplicates pair attempts and finalizes an immutable receipt", async () => {
    const repository = new MemoryExperimentRepository();
    const created = await repository.create(CANONICAL_SAFETY_SUITE);
    await repository.setStatus(created.experiment.id, "running");

    expect(
      await repository.addAttempt(created.experiment.id, completedAttemptFixture("weak")),
    ).toBe(true);
    expect(
      await repository.addAttempt(created.experiment.id, completedAttemptFixture("weak")),
    ).toBe(false);
    expect(
      await repository.addAttempt(
        created.experiment.id,
        completedAttemptFixture("hardened"),
      ),
    ).toBe(true);
    const completed = await repository.setStatus(
      created.experiment.id,
      "completed",
    );
    expect(completed.evidenceStatus).toBe("conclusive");

    const receipt = buildEvidenceReceiptFromExperiment({
      experiment: completed,
      suite: CANONICAL_SAFETY_SUITE,
      framework,
    });
    await repository.finalizeReceipt(created.experiment.id, receipt);
    expect(await repository.getReceipt(created.receiptToken)).toEqual(receipt);
    expect(await repository.getReceipt("wrong-token")).toBeUndefined();

    await repository.finalizeReceipt(created.experiment.id, receipt);
    await expect(
      repository.finalizeReceipt(created.experiment.id, {
        ...receipt,
        contentHash: "0".repeat(64),
      }),
    ).rejects.toThrow(/cannot be changed/i);
    await expect(
      repository.addAttempt(
        created.experiment.id,
        completedAttemptFixture("weak"),
      ),
    ).rejects.toThrow(/finalized/i);
    await expect(
      repository.setStatus(created.experiment.id, "running"),
    ).rejects.toThrow(/finalized/i);
  });

  it("does not produce a conclusive status from a partial pair", async () => {
    const repository = new MemoryExperimentRepository();
    const created = await repository.create(CANONICAL_SAFETY_SUITE);
    await repository.addAttempt(created.experiment.id, completedAttemptFixture("weak"));
    const partial = await repository.setStatus(
      created.experiment.id,
      "partial_failure",
    );
    expect(partial.evidenceStatus).toBe("inconclusive");
  });

  it("stores last frames off-hash and looks up receipts by id and contract", async () => {
    const repository = new MemoryExperimentRepository();
    const created = await repository.create(TICKETING_SAFETY_SUITE);
    await repository.setStatus(created.experiment.id, "running");
    await repository.addAttempt(created.experiment.id, completedAttemptFixture("weak"));
    await repository.addAttempt(created.experiment.id, completedAttemptFixture("hardened"));
    const completed = await repository.setStatus(created.experiment.id, "completed");
    const receipt = buildEvidenceReceiptFromExperiment({
      experiment: completed,
      suite: TICKETING_SAFETY_SUITE,
      framework,
    });
    await repository.finalizeReceipt(created.experiment.id, receipt);
    await repository.addFrame({
      experimentId: created.experiment.id,
      contractVariant: "weak",
      stepIndex: 3,
      at: "2026-09-03T00:00:00.000Z",
      toolCalls: [{ name: "charge_hold" }],
      screenshot: "data:image/jpeg;base64,weak",
    });
    expect(await repository.getReceiptById(receipt.receiptId)).toEqual(receipt);
    expect(await repository.latestDecisiveReceiptForContract(TICKETING_SAFETY_SUITE.id)).toEqual(
      receipt,
    );
    expect(await repository.latestDecisiveReceiptForContract("meeting-note-boundary")).toBeUndefined();
    expect(await repository.listFrames(created.experiment.id)).toEqual([
      expect.objectContaining({ contractVariant: "weak", screenshot: "data:image/jpeg;base64,weak" }),
    ]);
    expect(receipt).not.toHaveProperty("frames");
    expect(JSON.stringify(receipt)).not.toContain("client_secret");
  });
});

describe("charge latch gate", () => {
  it("allows only a trusted human apply on the ticketing hold", () => {
    expect(
      decideLatch({
        suiteId: "ticketing-seats-boundary",
        recordId: "HLD-2207",
        actor: "human",
        contractVariant: "hardened",
      }),
    ).toEqual({ allowed: true });
    expect(decideLatch({ suiteId: "ticketing-seats-boundary", recordId: "HLD-2207", actor: "human", attemptId: "attempt-1" }).allowed).toBe(false);
    expect(decideLatch({ suiteId: "ticketing-seats-boundary", recordId: "HLD-2207", actor: "human", contractVariant: "weak" }).allowed).toBe(false);
    expect(decideLatch({ suiteId: "meeting-note-boundary", recordId: "followup-001", actor: "human" }).allowed).toBe(false);
    expect(stripeTestSecret({ STRIPE_SECRET_KEY: "sk_live_nope" })).toBeUndefined();
    expect(stripeTestSecret({ STRIPE_SECRET_KEY: "sk_test_abc" })).toBe("sk_test_abc");
    rememberLatch("HLD-2207", "pi_test", "human");
    expect(readLatch("HLD-2207")).toMatchObject({ paymentIntentId: "pi_test", actor: "human" });
  });

  it("skips the PaymentIntent without a test key and stores a pi_ when Stripe answers", async () => {
    await expect(createTestPaymentIntent(18_600, {})).resolves.toEqual({ skipped: true });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "pi_test_186" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createTestPaymentIntent(18_600, { STRIPE_SECRET_KEY: "sk_test_abc" }),
    ).resolves.toEqual({ paymentIntentId: "pi_test_186", skipped: false });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/payment_intents",
      expect.objectContaining({ method: "POST" }),
    );
    vi.unstubAllGlobals();
  });
});

describe("capability hashing", () => {
  it("uses high-entropy raw tokens and constant-time digest comparison", () => {
    const token = createCapabilityToken();
    const hash = hashCapabilityToken(token);
    expect(token.length).toBeGreaterThan(40);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(capabilityMatches(token, hash)).toBe(true);
    expect(capabilityMatches(`${token}x`, hash)).toBe(false);
  });
});
