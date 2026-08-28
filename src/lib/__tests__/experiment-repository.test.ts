import { describe, expect, it } from "vitest";

import { CANONICAL_SAFETY_SUITE } from "@/lib/canonical-contract";
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
