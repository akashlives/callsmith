import { describe, expect, it } from "vitest";

import { CANONICAL_SAFETY_SUITE } from "@/lib/canonical-contract";
import { buildEvidenceReceiptFromExperiment, pipedreamConnectEnabled } from "@/lib/evidence-receipt-server";
import { ExperimentRecordV1Schema } from "@/lib/experiments";

import { completedAttemptFixture } from "./experiment-fixtures";

const framework = {
  nodeVersion: "24.20.0",
  applicationRevision: "receipt-test",
  frameworkManifestRevision: "manifest-test",
};

function experiment(
  weak = completedAttemptFixture("weak"),
  hardened = completedAttemptFixture("hardened"),
) {
  return ExperimentRecordV1Schema.parse({
    schemaVersion: 1,
    id: "experiment-receipt-branches",
    contractId: CANONICAL_SAFETY_SUITE.id,
    contractVersion: CANONICAL_SAFETY_SUITE.version,
    model: "gpt-5.6-luna",
    seed: 606,
    status: "completed",
    evidenceStatus: "conclusive",
    attempts: [weak, hardened],
    createdAt: "2026-08-28T20:00:00.000Z",
    updatedAt: "2026-08-28T20:01:00.000Z",
  });
}

describe("receipt conclusions", () => {
  it("hashes the decisive pair deterministically", () => {
    const first = buildEvidenceReceiptFromExperiment({
      experiment: experiment(),
      suite: CANONICAL_SAFETY_SUITE,
      framework,
    });
    const second = buildEvidenceReceiptFromExperiment({
      experiment: experiment(),
      suite: CANONICAL_SAFETY_SUITE,
      framework,
    });
    expect(first.conclusion).toBe("hardened_prevented_harm");
    expect(first.contentHash).toBe(second.contentHash);
  });

  it.each([
    ["no_unsafe_attempt", { unsafeAction: "not_attempted", protectedState: "preserved", harmPrevention: "not_exercised" }, { unsafeAction: "not_attempted", protectedState: "preserved", harmPrevention: "not_exercised" }],
    ["both_mutated", { unsafeAction: "attempted", protectedState: "mutated", harmPrevention: "failed" }, { unsafeAction: "attempted", protectedState: "mutated", harmPrevention: "failed" }],
    ["inconclusive", { unsafeAction: "attempted", protectedState: "unknown", harmPrevention: "not_exercised" }, { unsafeAction: "attempted", protectedState: "preserved", harmPrevention: "not_exercised" }],
    ["no_material_difference", { unsafeAction: "attempted", protectedState: "preserved", harmPrevention: "not_exercised" }, { unsafeAction: "attempted", protectedState: "preserved", harmPrevention: "not_exercised" }],
  ] as const)("derives %s without a score", (expected, weakFacts, hardenedFacts) => {
    const weak = completedAttemptFixture("weak");
    const hardened = completedAttemptFixture("hardened");
    Object.assign(weak.facts, weakFacts);
    Object.assign(hardened.facts, hardenedFacts);
    expect(
      buildEvidenceReceiptFromExperiment({
        experiment: experiment(weak, hardened),
        suite: CANONICAL_SAFETY_SUITE,
        framework,
      }).conclusion,
    ).toBe(expected);
  });

  it("rejects nonterminal and incomplete evidence", () => {
    expect(() =>
      buildEvidenceReceiptFromExperiment({
        experiment: { ...experiment(), status: "running", evidenceStatus: "pending" },
        suite: CANONICAL_SAFETY_SUITE,
        framework,
      }),
    ).toThrow(/terminal/i);
    expect(() =>
      buildEvidenceReceiptFromExperiment({
        experiment: { ...experiment(), attempts: [completedAttemptFixture("weak")] },
        suite: CANONICAL_SAFETY_SUITE,
        framework,
      }),
    ).toThrow(/complete weak\/hardened pair/i);
  });
});

describe("Pipedream Connect gate", () => {
  it("stays off unless all three env values are present", () => {
    expect(pipedreamConnectEnabled({})).toBe(false);
    expect(
      pipedreamConnectEnabled({
        PIPEDREAM_CLIENT_ID: "id",
        PIPEDREAM_CLIENT_SECRET: "secret",
      }),
    ).toBe(false);
    expect(
      pipedreamConnectEnabled({
        PIPEDREAM_CLIENT_ID: "id",
        PIPEDREAM_CLIENT_SECRET: "secret",
        PIPEDREAM_PROJECT_ID: "proj",
      }),
    ).toBe(true);
  });
});
