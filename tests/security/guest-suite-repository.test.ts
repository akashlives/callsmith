import { describe, expect, it } from "vitest";

import {
  InMemorySuiteRepositoryBackend,
  SuiteRepository,
  type SuiteRepositoryErrorCode,
} from "@/lib/suite-repository";
import { SUPPORT_ESCALATION_SUITE } from "@/lib/suites";

function candidateSuite(id = "guest-security-suite") {
  const suite = structuredClone(SUPPORT_ESCALATION_SUITE);
  suite.id = id;
  suite.title = "Guest Security Suite";
  return suite;
}

async function expectRepositoryError(
  operation: Promise<unknown>,
  code: SuiteRepositoryErrorCode,
) {
  await expect(operation).rejects.toMatchObject({ code });
}

describe("guest suite repository security", () => {
  it("stores only token hashes and survives repository re-instantiation", async () => {
    const backend = new InMemorySuiteRepositoryBackend();
    const firstProcess = new SuiteRepository(backend);
    const created = await firstProcess.createDraft({
      goal: "Test a synthetic support escalation workflow",
    });

    const draftSnapshot = backend.snapshot();
    expect(draftSnapshot.drafts).toHaveLength(1);
    expect(draftSnapshot.drafts[0].ownerTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(draftSnapshot)).not.toContain(created.ownerToken);
    expect(created.draft).not.toHaveProperty("ownerTokenHash");

    const secondProcess = new SuiteRepository(backend);
    await expect(
      secondProcess.getDraft(created.draft.id, created.ownerToken),
    ).resolves.toMatchObject({ id: created.draft.id, status: "draft" });
    await expect(
      secondProcess.getDraft(created.draft.id, "cs_owner_wrong"),
    ).resolves.toBeUndefined();

    const challenge = await secondProcess.requestApproval(
      created.draft.id,
      created.ownerToken,
      candidateSuite(),
    );
    const challengeSnapshot = backend.snapshot();
    expect(challengeSnapshot.drafts[0].confirmationTokenHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(JSON.stringify(challengeSnapshot)).not.toContain(
      challenge.confirmationToken,
    );
    expect(challenge.draft).not.toHaveProperty("confirmationTokenHash");

    const restartedProcess = new SuiteRepository(backend);
    const published = await restartedProcess.approveDraft(
      created.draft.id,
      created.ownerToken,
      challenge.confirmationToken,
    );
    const publishedSnapshot = backend.snapshot();
    expect(publishedSnapshot.suites).toHaveLength(1);
    expect(publishedSnapshot.suites[0].capabilityTokenHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(JSON.stringify(publishedSnapshot)).not.toContain(
      published.capabilityToken,
    );
    expect(published.suite).not.toHaveProperty("capabilityTokenHash");

    const workerAfterRestart = new SuiteRepository(backend);
    await expect(
      workerAfterRestart.resolveSuite(published.capabilityToken),
    ).resolves.toMatchObject({
      suiteId: "guest-security-suite",
      suiteVersion: SUPPORT_ESCALATION_SUITE.version,
    });
    await expect(
      workerAfterRestart.getSuiteInternal(
        "guest-security-suite",
        SUPPORT_ESCALATION_SUITE.version,
      ),
    ).resolves.toMatchObject({ sourceDraftId: created.draft.id });
  });

  it("returns defensive clones and prevents replacement or second publication", async () => {
    const backend = new InMemorySuiteRepositoryBackend();
    const repository = new SuiteRepository(backend);
    const created = await repository.createDraft({ goal: "immutable suite" });
    const challenge = await repository.requestApproval(
      created.draft.id,
      created.ownerToken,
      candidateSuite(),
    );
    const published = await repository.approveDraft(
      created.draft.id,
      created.ownerToken,
      challenge.confirmationToken,
    );

    published.suite.definition.title = "Mutated caller copy";
    const reread = await repository.resolveSuite(published.capabilityToken);
    expect(reread?.definition.title).toBe("Guest Security Suite");

    if (reread) reread.definition.title = "Mutated resolved copy";
    await expect(
      new SuiteRepository(backend).resolveSuite(published.capabilityToken),
    ).resolves.toMatchObject({
      definition: { title: "Guest Security Suite" },
    });
    await expectRepositoryError(
      repository.approveDraft(
        created.draft.id,
        created.ownerToken,
        challenge.confirmationToken,
      ),
      "DRAFT_ALREADY_PUBLISHED",
    );
    await expectRepositoryError(
      repository.rejectDraft(created.draft.id, created.ownerToken),
      "DRAFT_ALREADY_PUBLISHED",
    );

    const duplicate = await repository.createDraft({ goal: "replace version" });
    const duplicateChallenge = await repository.requestApproval(
      duplicate.draft.id,
      duplicate.ownerToken,
      candidateSuite(),
    );
    await expectRepositoryError(
      repository.approveDraft(
        duplicate.draft.id,
        duplicate.ownerToken,
        duplicateChallenge.confirmationToken,
      ),
      "SUITE_VERSION_EXISTS",
    );
    expect(backend.snapshot().suites).toHaveLength(1);
  });

  it("rejects missing, wrong, expired, and rejected approval capabilities", async () => {
    let nowMs = Date.parse("2026-08-27T12:00:00.000Z");
    const backend = new InMemorySuiteRepositoryBackend();
    const repository = new SuiteRepository(backend, {
      now: () => new Date(nowMs),
      confirmationTtlMs: 1_000,
    });
    const created = await repository.createDraft({ goal: "expiring approval" });

    await expectRepositoryError(
      repository.requestApproval(
        created.draft.id,
        "cs_owner_wrong",
        candidateSuite(),
      ),
      "DRAFT_NOT_FOUND",
    );
    const challenge = await repository.requestApproval(
      created.draft.id,
      created.ownerToken,
      candidateSuite(),
    );
    await expectRepositoryError(
      repository.approveDraft(created.draft.id, created.ownerToken, ""),
      "CONFIRMATION_INVALID",
    );
    await expectRepositoryError(
      repository.approveDraft(
        created.draft.id,
        created.ownerToken,
        "cs_confirm_wrong",
      ),
      "CONFIRMATION_INVALID",
    );

    nowMs += 1_000;
    await expectRepositoryError(
      repository.approveDraft(
        created.draft.id,
        created.ownerToken,
        challenge.confirmationToken,
      ),
      "CONFIRMATION_EXPIRED",
    );
    expect(backend.snapshot().suites).toHaveLength(0);

    const rejected = await repository.createDraft({ goal: "rejected suite" });
    const rejectedChallenge = await repository.requestApproval(
      rejected.draft.id,
      rejected.ownerToken,
      candidateSuite("rejected-security-suite"),
    );
    await repository.rejectDraft(rejected.draft.id, rejected.ownerToken);
    await expectRepositoryError(
      repository.approveDraft(
        rejected.draft.id,
        rejected.ownerToken,
        rejectedChallenge.confirmationToken,
      ),
      "DRAFT_REJECTED",
    );
    expect(backend.snapshot().suites).toHaveLength(0);
  });

  it("does not resolve missing, malformed, or incorrect suite capabilities", async () => {
    const repository = new SuiteRepository(
      new InMemorySuiteRepositoryBackend(),
    );
    await expect(repository.resolveSuite("")).resolves.toBeUndefined();
    await expect(repository.resolveSuite("not-a-capability")).resolves.toBeUndefined();
    await expect(repository.resolveSuite("cs_suite_wrong")).resolves.toBeUndefined();
  });
});
