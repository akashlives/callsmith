import { describe, expect, it } from "vitest";

import { CANONICAL_SAFETY_CONTRACT } from "@/lib/canonical-contract";
import { MemoryContractProposalRepository } from "@/lib/contract-proposal-repository";

describe("asynchronous contract proposal repository", () => {
  it("separates read status, owner review, and human decision capabilities", async () => {
    const repository = new MemoryContractProposalRepository();
    const created = await repository.create(CANONICAL_SAFETY_CONTRACT);

    expect(
      await repository.getStatus(created.proposal.id, created.statusToken),
    ).toMatchObject({ status: "awaiting_review" });
    expect(
      await repository.getReview(created.proposal.id, created.ownerToken),
    ).toMatchObject({ draft: { title: "The meeting-note trap" } });
    expect(
      await repository.getStatus(created.proposal.id, created.decisionToken),
    ).toBeUndefined();
    expect(
      await repository.getReview(created.proposal.id, created.statusToken),
    ).toBeUndefined();
  });

  it("allows one explicit decision and creates no experiment on rejection", async () => {
    const repository = new MemoryContractProposalRepository();
    const created = await repository.create(CANONICAL_SAFETY_CONTRACT);
    const rejected = await repository.decide(
      created.proposal.id,
      created.decisionToken,
      "reject",
    );
    expect(rejected).toMatchObject({ status: "rejected" });
    expect(rejected.experimentId).toBeUndefined();
    await expect(
      repository.decide(created.proposal.id, created.decisionToken, "approve"),
    ).rejects.toThrow(/already been decided/i);
  });

  it("attaches exactly one experiment after approval", async () => {
    const repository = new MemoryContractProposalRepository();
    const created = await repository.create(CANONICAL_SAFETY_CONTRACT);
    await repository.decide(
      created.proposal.id,
      created.decisionToken,
      "approve",
    );
    expect(
      await repository.attachExperiment(created.proposal.id, "experiment-one"),
    ).toMatchObject({ status: "approved", experimentId: "experiment-one" });
    await expect(
      repository.attachExperiment(created.proposal.id, "experiment-two"),
    ).rejects.toThrow(/cannot attach another/i);
  });

  it("rejects fabricated approval capabilities", async () => {
    const repository = new MemoryContractProposalRepository();
    const created = await repository.create(CANONICAL_SAFETY_CONTRACT);
    await expect(
      repository.decide(created.proposal.id, "fabricated", "approve"),
    ).rejects.toThrow(/not found/i);
    expect(
      await repository.getStatus(created.proposal.id, created.statusToken),
    ).toMatchObject({ status: "awaiting_review" });
  });
});

