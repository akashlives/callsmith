import { afterEach, describe, expect, it } from "vitest";

import { POST as approveAndRun } from "@/app/api/suite-drafts/[id]/approve-and-run/route";
import { GET as getDraft } from "@/app/api/suite-drafts/[id]/route";
import { POST as rejectDraft } from "@/app/api/suite-drafts/[id]/reject/route";
import { POST as createDraft } from "@/app/api/suite-drafts/route";
import { runStore } from "@/lib/run-store";
import {
  resetSuiteRepositoryForTests,
  suiteRepository,
} from "@/lib/suite-repository";
import { SALES_GAUNTLET_SUITE } from "@/lib/suites";

let uniqueId = 0;

function privateSuite() {
  uniqueId += 1;
  const suite = structuredClone(SALES_GAUNTLET_SUITE);
  suite.id = `reject-boundary-${uniqueId}`;
  suite.title = `Reject Boundary ${uniqueId}`;
  return suite;
}

function post(url: string, authorization?: string, body?: unknown) {
  return new Request(url, {
    method: "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(authorization ? { authorization } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createPendingDraft() {
  const suite = privateSuite();
  const response = await createDraft(
    post("http://callsmith.test/api/suite-drafts", undefined, { suite }),
  );
  expect(response.status).toBe(201);
  const created = (await response.json()) as {
    draft: { id: string; revision: number; status: string };
    ownerToken: string;
    confirmationToken: string;
    links: { reject: string };
  };
  return { suite, created };
}

function rejectRequest(
  draftId: string,
  ownerToken?: string,
) {
  return rejectDraft(
    post(
      `http://callsmith.test/api/suite-drafts/${draftId}/reject`,
      ownerToken ? `Bearer ${ownerToken}` : undefined,
    ),
    { params: Promise.resolve({ id: draftId }) },
  );
}

afterEach(() => {
  runStore.clear();
  resetSuiteRepositoryForTests();
});

describe("suite draft rejection API", () => {
  it("rejects a pending draft without publishing a suite or creating a run", async () => {
    const { suite, created } = await createPendingDraft();
    expect(created.links.reject).toBe(
      `/api/suite-drafts/${created.draft.id}/reject`,
    );
    expect(runStore.size).toBe(0);

    const response = await rejectRequest(
      created.draft.id,
      created.ownerToken,
    );
    expect(response.status).toBe(200);
    const rejected = (await response.json()) as {
      rejected: boolean;
      published: boolean;
      runCreated: boolean;
      draft: {
        status: string;
        revision: number;
        candidateSuite?: unknown;
        confirmationExpiresAt?: string;
      };
    };
    expect(rejected).toMatchObject({
      rejected: true,
      published: false,
      runCreated: false,
      draft: { status: "rejected" },
    });
    expect(rejected.draft).not.toHaveProperty("candidateSuite");
    expect(rejected.draft).not.toHaveProperty("confirmationExpiresAt");
    expect(runStore.size).toBe(0);
    expect(
      await suiteRepository.getSuiteInternal(suite.id, suite.version),
    ).toBeUndefined();

    const ownerRead = await getDraft(
      new Request("http://callsmith.test", {
        headers: { authorization: `Bearer ${created.ownerToken}` },
      }),
      { params: Promise.resolve({ id: created.draft.id }) },
    );
    await expect(ownerRead.json()).resolves.toMatchObject({
      draft: { status: "rejected", revision: rejected.draft.revision },
    });

    const approvalAfterRejection = await approveAndRun(
      post(
        `http://callsmith.test/api/suite-drafts/${created.draft.id}/approve-and-run`,
        `Bearer ${created.ownerToken}`,
        {},
      ),
      { params: Promise.resolve({ id: created.draft.id }) },
    );
    expect(approvalAfterRejection.status).toBe(409);
    expect(runStore.size).toBe(0);
  });

  it("does not reveal whether a draft or owner capability exists", async () => {
    const { created } = await createPendingDraft();
    const missingOwner = await rejectRequest(created.draft.id);
    const wrongOwner = await rejectRequest(
      created.draft.id,
      "cs_owner_wrong",
    );
    const missingDraft = await rejectRequest(
      "draft-does-not-exist",
      created.ownerToken,
    );

    expect(missingOwner.status).toBe(404);
    expect(wrongOwner.status).toBe(404);
    expect(missingDraft.status).toBe(404);
    const [missingOwnerBody, wrongOwnerBody, missingDraftBody] =
      await Promise.all([
        missingOwner.text(),
        wrongOwner.text(),
        missingDraft.text(),
      ]);
    expect(missingOwnerBody).toBe(wrongOwnerBody);
    expect(wrongOwnerBody).toBe(missingDraftBody);

    const ownerRead = await getDraft(
      new Request("http://callsmith.test", {
        headers: { authorization: `Bearer ${created.ownerToken}` },
      }),
      { params: Promise.resolve({ id: created.draft.id }) },
    );
    await expect(ownerRead.json()).resolves.toMatchObject({
      draft: { status: "awaiting_confirmation" },
    });
    expect(runStore.size).toBe(0);
  });

  it("is idempotent after rejection and preserves the rejected revision", async () => {
    const { created } = await createPendingDraft();
    const first = await rejectRequest(created.draft.id, created.ownerToken);
    const firstBody = (await first.json()) as {
      draft: { revision: number; status: string };
    };
    const duplicate = await rejectRequest(created.draft.id, created.ownerToken);
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      rejected: true,
      runCreated: false,
      draft: {
        status: "rejected",
        revision: firstBody.draft.revision,
      },
    });
    expect(runStore.size).toBe(0);
  });

  it("rejects attempts to reverse an approved immutable publication", async () => {
    const { suite, created } = await createPendingDraft();
    await suiteRepository.approveDraft(
      created.draft.id,
      created.ownerToken,
      created.confirmationToken,
    );

    const response = await rejectRequest(
      created.draft.id,
      created.ownerToken,
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Suite draft cannot be rejected",
    });
    expect(
      await suiteRepository.getSuiteInternal(suite.id, suite.version),
    ).toBeDefined();
    expect(runStore.size).toBe(0);
  });

  it("collapses concurrent stale rejection into one success and one conflict", async () => {
    const { created } = await createPendingDraft();
    const [left, right] = await Promise.all([
      rejectRequest(created.draft.id, created.ownerToken),
      rejectRequest(created.draft.id, created.ownerToken),
    ]);

    expect([left.status, right.status].sort()).toEqual([200, 409]);
    const conflict = left.status === 409 ? left : right;
    await expect(conflict.json()).resolves.toEqual({
      error: "Suite draft cannot be rejected",
    });
    expect(runStore.size).toBe(0);
  });
});
