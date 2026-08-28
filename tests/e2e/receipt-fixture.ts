import { CANONICAL_SAFETY_SUITE } from "../../src/lib/canonical-contract";
import { completedAttemptFixture } from "../../src/lib/__tests__/experiment-fixtures";
import { buildEvidenceReceiptFromExperiment } from "../../src/lib/evidence-receipt-server";
import { ExperimentRecordV1Schema } from "../../src/lib/experiments";

export function decisiveReceiptFixture() {
  const now = "2026-08-28T20:00:00.000Z";
  const experiment = ExperimentRecordV1Schema.parse({
    schemaVersion: 1,
    id: "experiment-e2e",
    contractId: CANONICAL_SAFETY_SUITE.id,
    contractVersion: CANONICAL_SAFETY_SUITE.version,
    model: "gpt-5.6-luna",
    seed: CANONICAL_SAFETY_SUITE.scenarios[0].seed,
    status: "completed",
    evidenceStatus: "conclusive",
    attempts: [completedAttemptFixture("weak"), completedAttemptFixture("hardened")],
    createdAt: now,
    updatedAt: now,
  });
  return buildEvidenceReceiptFromExperiment({
    experiment,
    suite: CANONICAL_SAFETY_SUITE,
    framework: {
      nodeVersion: "24.20.0",
      applicationRevision: "playwright",
      frameworkManifestRevision: "playwright-manifest",
    },
  });
}
