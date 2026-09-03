import Redis from "ioredis";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CANONICAL_SAFETY_CONTRACT, CANONICAL_SAFETY_SUITE } from "@/lib/canonical-contract";
import { PostgresContractProposalRepository } from "@/lib/contract-proposal-repository";
import { buildEvidenceReceiptFromExperiment } from "@/lib/evidence-receipt-server";
import {
  closeExperimentQueue,
  enqueueExperiment,
  readExperimentEvents,
} from "@/lib/experiment-queue";
import { PostgresExperimentRepository } from "@/lib/experiment-repository";

import { completedAttemptFixture } from "../../src/lib/__tests__/experiment-fixtures";

const databaseUrl = process.env.CALLSMITH_INTEGRATION_DATABASE_URL;
const redisUrl = process.env.CALLSMITH_INTEGRATION_REDIS_URL;
const integration = databaseUrl && redisUrl ? describe : describe.skip;

integration("real Postgres and Redis durability", () => {
  const sql = postgres(databaseUrl!, { max: 3, prepare: false });
  const redis = new Redis(redisUrl!, { maxRetriesPerRequest: 2 });
  const experiments = new PostgresExperimentRepository(sql);
  const proposals = new PostgresContractProposalRepository(sql);

  beforeAll(async () => {
    process.env.REDIS_URL = redisUrl;
    await redis.flushdb();
  });

  afterAll(async () => {
    await closeExperimentQueue();
    await redis.quit();
    await sql.end();
    delete process.env.REDIS_URL;
  });

  it("persists, dispatches, deduplicates, finalizes, and locks an experiment", async () => {
    const created = await experiments.create(CANONICAL_SAFETY_SUITE);
    expect(await experiments.get(created.experiment.id, "wrong")).toBeUndefined();
    expect(
      await experiments.get(created.experiment.id, created.accessToken),
    ).toMatchObject({ status: "queued" });
    expect(await experiments.pendingDispatch()).toContain(created.experiment.id);

    await enqueueExperiment(created.experiment.id);
    await experiments.markDispatched(created.experiment.id);
    expect(await experiments.pendingDispatch()).not.toContain(created.experiment.id);
    const queueEvents = await readExperimentEvents(
      created.experiment.id,
      "0-0",
      10,
    );
    expect(queueEvents.map((item) => item.event.type)).toContain("queued");

    await experiments.setStatus(created.experiment.id, "running");
    expect(
      await experiments.addAttempt(
        created.experiment.id,
        completedAttemptFixture("weak"),
      ),
    ).toBe(true);
    expect(
      await experiments.addAttempt(
        created.experiment.id,
        completedAttemptFixture("weak"),
      ),
    ).toBe(false);
    await experiments.addAttempt(
      created.experiment.id,
      completedAttemptFixture("hardened"),
    );
    const completed = await experiments.setStatus(
      created.experiment.id,
      "completed",
    );
    expect(completed.evidenceStatus).toBe("conclusive");

    const receipt = buildEvidenceReceiptFromExperiment({
      experiment: completed,
      suite: CANONICAL_SAFETY_SUITE,
      framework: {
        nodeVersion: "24.20.0",
        applicationRevision: "integration",
        frameworkManifestRevision: "integration-manifest",
      },
    });
    await experiments.finalizeReceipt(created.experiment.id, receipt);
    expect(await experiments.getReceipt(created.receiptToken)).toEqual(receipt);
    expect(await experiments.getReceiptById(receipt.receiptId)).toEqual(receipt);
    expect(
      await experiments.latestDecisiveReceiptForContract(CANONICAL_SAFETY_SUITE.id),
    ).toEqual(receipt);
    await experiments.addFrame({
      experimentId: created.experiment.id,
      contractVariant: "hardened",
      stepIndex: 2,
      at: new Date().toISOString(),
      toolCalls: [],
      screenshot: "data:image/jpeg;base64,frame",
    });
    expect(await experiments.listFrames(created.experiment.id)).toEqual([
      expect.objectContaining({
        contractVariant: "hardened",
        screenshot: "data:image/jpeg;base64,frame",
      }),
    ]);
    await experiments.finalizeReceipt(created.experiment.id, receipt);
    await expect(
      experiments.setStatus(created.experiment.id, "running"),
    ).rejects.toThrow(/finalized/i);
    await expect(
      experiments.addAttempt(
        created.experiment.id,
        completedAttemptFixture("weak"),
      ),
    ).rejects.toThrow(/finalized/i);
  });

  it("keeps proposal capabilities separate and decisions one-shot", async () => {
    const rejected = await proposals.create(CANONICAL_SAFETY_CONTRACT);
    expect(await proposals.getStatus(rejected.proposal.id, rejected.ownerToken)).toBeUndefined();
    expect(await proposals.getReview(rejected.proposal.id, rejected.statusToken)).toBeUndefined();
    expect(
      await proposals.decide(rejected.proposal.id, rejected.decisionToken, "reject"),
    ).toMatchObject({ status: "rejected" });
    await expect(
      proposals.decide(rejected.proposal.id, rejected.decisionToken, "approve"),
    ).rejects.toThrow(/already been decided/i);

    const approved = await proposals.create(CANONICAL_SAFETY_CONTRACT);
    await proposals.decide(approved.proposal.id, approved.decisionToken, "approve");
    await proposals.attachExperiment(approved.proposal.id, "experiment-integration-link");
    await expect(
      proposals.attachExperiment(approved.proposal.id, "experiment-second-link"),
    ).rejects.toThrow(/another experiment/i);
  });
});
