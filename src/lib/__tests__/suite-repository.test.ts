import { describe, expect, it } from "vitest";

import type { SuiteDefinition } from "@/lib/contracts";
import {
  InMemorySuiteRepositoryBackend,
  MAX_DRAFT_BYTES,
  SuiteRepository,
} from "@/lib/suite-repository";
import {
  SUPPORT_ESCALATION_SUITE,
  listSuites,
} from "@/lib/suites";

function candidate(
  id = "guest-support-safety",
  version = "1.0.0",
): SuiteDefinition {
  const suite = structuredClone(SUPPORT_ESCALATION_SUITE);
  suite.id = id;
  suite.version = version;
  suite.title = "Guest Support Safety";
  return suite;
}

async function draftAndChallenge(
  repository: SuiteRepository,
  suite = candidate(),
) {
  const created = await repository.createDraft({
    title: suite.title,
    intent: "Test an unlisted synthetic support workflow",
  });
  const challenge = await repository.requestApproval(
    created.draft.id,
    created.ownerToken,
    suite,
  );
  return { ...created, challenge, suite };
}

describe("SuiteRepository capabilities", () => {
  it("persists only token hashes and requires the correct owner capability", async () => {
    const backend = new InMemorySuiteRepositoryBackend();
    const repository = new SuiteRepository(backend);
    const created = await repository.createDraft({ title: "Private draft" });

    expect(created.ownerToken).toMatch(/^cs_owner_/);
    expect(created.draft).not.toHaveProperty("ownerTokenHash");
    expect(
      await repository.getDraft(created.draft.id, "cs_owner_incorrect"),
    ).toBeUndefined();
    expect(
      await repository.getDraft(created.draft.id, created.ownerToken),
    ).toMatchObject({ id: created.draft.id, status: "draft" });

    const snapshot = backend.snapshot();
    expect(snapshot.drafts[0].ownerTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(snapshot)).not.toContain(created.ownerToken);
  });

  it("publishes one immutable unlisted suite without changing the catalog", async () => {
    const catalogBefore = listSuites().map(({ id, version }) => `${id}@${version}`);
    const backend = new InMemorySuiteRepositoryBackend();
    const repository = new SuiteRepository(backend);
    const { draft, ownerToken, challenge, suite } = await draftAndChallenge(
      repository,
    );

    expect(challenge.confirmationToken).toMatch(/^cs_confirm_/);
    const published = await repository.approveDraft(
      draft.id,
      ownerToken,
      challenge.confirmationToken,
    );
    expect(published.capabilityToken).toMatch(/^cs_suite_/);
    expect(published.suite).toMatchObject({
      suiteId: suite.id,
      suiteVersion: suite.version,
      sourceDraftId: draft.id,
      definition: { title: suite.title },
    });
    expect(listSuites().map(({ id, version }) => `${id}@${version}`)).toEqual(
      catalogBefore,
    );
    expect(
      await repository.resolveSuite("cs_suite_incorrect"),
    ).toBeUndefined();
    expect(
      await repository.resolveSuite(published.capabilityToken),
    ).toMatchObject({ suiteId: suite.id, suiteVersion: suite.version });
    expect(await repository.getSuiteInternal(suite.id, suite.version)).toMatchObject({
      sourceDraftId: draft.id,
    });

    published.suite.definition.title = "Mutated response";
    expect(
      (await repository.resolveSuite(published.capabilityToken))?.definition.title,
    ).toBe("Guest Support Safety");

    const stored = JSON.stringify(backend.snapshot());
    expect(stored).not.toContain(ownerToken);
    expect(stored).not.toContain(challenge.confirmationToken);
    expect(stored).not.toContain(published.capabilityToken);
    expect(backend.snapshot().suites[0].capabilityTokenHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it("survives repository re-instantiation when the persistence backend survives", async () => {
    const backend = new InMemorySuiteRepositoryBackend();
    const firstProcess = new SuiteRepository(backend);
    const { draft, ownerToken, challenge } = await draftAndChallenge(firstProcess);
    const published = await firstProcess.approveDraft(
      draft.id,
      ownerToken,
      challenge.confirmationToken,
    );

    const restartedProcess = new SuiteRepository(backend);
    expect(
      await restartedProcess.getDraft(draft.id, ownerToken),
    ).toMatchObject({ status: "published", revision: 2 });
    expect(
      await restartedProcess.resolveSuite(published.capabilityToken),
    ).toMatchObject({ definition: { id: "guest-support-safety" } });
  });

  it("enforces suite id and version uniqueness across drafts", async () => {
    const repository = new SuiteRepository(
      new InMemorySuiteRepositoryBackend(),
    );
    const first = await draftAndChallenge(repository);
    await repository.approveDraft(
      first.draft.id,
      first.ownerToken,
      first.challenge.confirmationToken,
    );
    const second = await draftAndChallenge(repository, candidate());

    await expect(
      repository.approveDraft(
        second.draft.id,
        second.ownerToken,
        second.challenge.confirmationToken,
      ),
    ).rejects.toMatchObject({ code: "SUITE_VERSION_EXISTS" });
    expect(
      (await repository.getDraft(second.draft.id, second.ownerToken))?.status,
    ).toBe("awaiting_confirmation");
  });

  it("cannot shadow an exact built-in suite version", async () => {
    const repository = new SuiteRepository(
      new InMemorySuiteRepositoryBackend(),
    );
    const pending = await draftAndChallenge(
      repository,
      structuredClone(SUPPORT_ESCALATION_SUITE),
    );
    await expect(
      repository.approveDraft(
        pending.draft.id,
        pending.ownerToken,
        pending.challenge.confirmationToken,
      ),
    ).rejects.toMatchObject({ code: "SUITE_VERSION_EXISTS" });
  });

  it("rejects missing, incorrect, expired, and duplicate confirmation", async () => {
    let nowMs = Date.parse("2026-08-27T00:00:00.000Z");
    const repository = new SuiteRepository(
      new InMemorySuiteRepositoryBackend(),
      { now: () => new Date(nowMs), confirmationTtlMs: 1_000 },
    );
    const missing = await repository.createDraft({ title: "Missing challenge" });
    await expect(
      repository.approveDraft(
        missing.draft.id,
        missing.ownerToken,
        "cs_confirm_missing",
      ),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });

    const pending = await draftAndChallenge(repository);
    await expect(
      repository.approveDraft(
        pending.draft.id,
        pending.ownerToken,
        "cs_confirm_incorrect",
      ),
    ).rejects.toMatchObject({ code: "CONFIRMATION_INVALID" });
    nowMs += 1_000;
    await expect(
      repository.approveDraft(
        pending.draft.id,
        pending.ownerToken,
        pending.challenge.confirmationToken,
      ),
    ).rejects.toMatchObject({ code: "CONFIRMATION_EXPIRED" });

    nowMs = Date.parse("2026-08-27T00:10:00.000Z");
    const approved = await draftAndChallenge(repository, candidate("other-suite"));
    await repository.approveDraft(
      approved.draft.id,
      approved.ownerToken,
      approved.challenge.confirmationToken,
    );
    await expect(
      repository.approveDraft(
        approved.draft.id,
        approved.ownerToken,
        approved.challenge.confirmationToken,
      ),
    ).rejects.toMatchObject({ code: "DRAFT_ALREADY_PUBLISHED" });
  });

  it("keeps rejected drafts private and permanently non-publishable", async () => {
    const repository = new SuiteRepository(
      new InMemorySuiteRepositoryBackend(),
    );
    const pending = await draftAndChallenge(repository);
    const rejected = await repository.rejectDraft(
      pending.draft.id,
      pending.ownerToken,
    );
    expect(rejected.status).toBe("rejected");
    expect(rejected).not.toHaveProperty("candidateSuite");
    await expect(
      repository.approveDraft(
        pending.draft.id,
        pending.ownerToken,
        pending.challenge.confirmationToken,
      ),
    ).rejects.toMatchObject({ code: "DRAFT_REJECTED" });
    expect(
      await repository.getSuiteInternal(
        pending.suite.id,
        pending.suite.version,
      ),
    ).toBeUndefined();
  });

  it("rejects non-JSON and oversized draft or candidate inputs", async () => {
    const repository = new SuiteRepository(
      new InMemorySuiteRepositoryBackend(),
    );
    await expect(repository.createDraft({ execute: () => true })).rejects.toMatchObject({
      code: "INVALID_DRAFT",
    });
    await expect(
      repository.createDraft({ body: "x".repeat(MAX_DRAFT_BYTES) }),
    ).rejects.toMatchObject({ code: "DRAFT_TOO_LARGE" });

    const created = await repository.createDraft({ title: "Bounded candidate" });
    const oversized = candidate("oversized-suite");
    oversized.scenarios[0].initialState = {
      ...oversized.scenarios[0].initialState,
      oversized: "x".repeat(MAX_DRAFT_BYTES),
    };
    await expect(
      repository.requestApproval(
        created.draft.id,
        created.ownerToken,
        oversized,
      ),
    ).rejects.toMatchObject({ code: "DRAFT_TOO_LARGE" });

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(
      repository.requestApproval(
        created.draft.id,
        created.ownerToken,
        circular,
      ),
    ).rejects.toMatchObject({ code: "INVALID_SUITE" });
  });

  it("does not reveal whether a draft exists to an incorrect owner token", async () => {
    const repository = new SuiteRepository(
      new InMemorySuiteRepositoryBackend(),
    );
    const created = await repository.createDraft({ title: "Private" });
    await expect(
      repository.requestApproval(
        created.draft.id,
        "cs_owner_incorrect",
        candidate(),
      ),
    ).rejects.toMatchObject({
      code: "DRAFT_NOT_FOUND",
      message: "Draft not found or owner capability is invalid.",
    });
  });
});
