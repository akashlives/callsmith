import { describe, expect, it } from "vitest";

import { buildBenchmarkReport, wilsonInterval } from "@/lib/benchmark";
import { CANONICAL_SAFETY_SUITE } from "@/lib/canonical-contract";
import { completedAttemptFixture } from "@/lib/__tests__/experiment-fixtures";
import { buildEvidenceReceiptFromExperiment } from "@/lib/evidence-receipt-server";
import { ExperimentRecordV1Schema } from "@/lib/experiments";

function receipt(seed: number) {
  const experiment = ExperimentRecordV1Schema.parse({
    schemaVersion: 1,
    id: `experiment-benchmark-${seed}`,
    contractId: CANONICAL_SAFETY_SUITE.id,
    contractVersion: CANONICAL_SAFETY_SUITE.version,
    model: "gpt-5.6-luna",
    seed,
    status: "completed",
    evidenceStatus: "conclusive",
    attempts: [completedAttemptFixture("weak"), completedAttemptFixture("hardened")],
    createdAt: "2026-08-28T20:00:00.000Z",
    updatedAt: "2026-08-28T20:01:00.000Z",
  });
  return buildEvidenceReceiptFromExperiment({
    experiment,
    suite: CANONICAL_SAFETY_SUITE,
    framework: {
      nodeVersion: "24.20.0",
      applicationRevision: "benchmark-test",
      frameworkManifestRevision: "manifest-test",
    },
  });
}

describe("benchmark evidence", () => {
  it("computes bounded Wilson confidence intervals", () => {
    const none = wilsonInterval(0, 10);
    expect(none.low).toBe(0);
    expect(none.high).toBeCloseTo(0.2775327998628892);
    const all = wilsonInterval(10, 10);
    expect(all.low).toBeCloseTo(0.7224672001371107);
    expect(all.high).toBe(1);
  });

  it("reports matched-pair coverage, rates, latency, and provenance", () => {
    const report = buildBenchmarkReport([receipt(601), receipt(602)], [601, 602, 603]);
    expect(report.coverage).toEqual({
      expectedPairs: 3,
      completedPairs: 2,
      missingSeeds: [603],
    });
    expect(report.rates.baselineCallsmithDisagreement).toMatchObject({
      successes: 2,
      total: 2,
      rate: 1,
    });
    expect(report.receipts[0]).toMatchObject({
      seed: 601,
      conclusion: "hardened_prevented_harm",
      execution: { model: "gpt-5.6-luna" },
    });
  });

  it("rejects duplicate seeds and duplicate receipt coverage", () => {
    expect(() => buildBenchmarkReport([receipt(601)], [601, 601])).toThrow(
      "Benchmark seeds must be unique",
    );
    expect(() => buildBenchmarkReport([receipt(601), receipt(601)], [601])).toThrow(
      "duplicate receipt seed 601",
    );
  });
});
