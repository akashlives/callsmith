import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as approveAndRun } from "@/app/api/suite-drafts/[id]/approve-and-run/route";
import { GET as getDraft } from "@/app/api/suite-drafts/[id]/route";
import { POST as createDraft } from "@/app/api/suite-drafts/route";
import { POST as createRun } from "@/app/api/runs/route";
import {
  GET as listPublicSuites,
  POST as legacyImportSuite,
} from "@/app/api/suites/route";
import { GET as getUnlistedSuite } from "@/app/api/suites/unlisted/[token]/route";
import { runStore } from "@/lib/run-store";
import { SUPPORT_ESCALATION_SUITE } from "@/lib/suites";

type CreatedDraft = {
  draft: { id: string; status: string };
  ownerToken: string;
  confirmationToken: string;
  confirmationExpiresAt: string;
};

function candidateSuite(id: string) {
  const suite = structuredClone(SUPPORT_ESCALATION_SUITE);
  suite.id = id;
  suite.title = "Private Guest Security Suite";
  return suite;
}

function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function createGuestDraft(suiteId: string): Promise<CreatedDraft> {
  const response = await createDraft(
    jsonRequest("http://callsmith.test/api/suite-drafts", {
      suite: candidateSuite(suiteId),
    }),
  );
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  return (await response.json()) as CreatedDraft;
}

function draftContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function unlistedContext(token: string) {
  return { params: Promise.resolve({ token }) };
}

describe("guest suite capability API", () => {
  beforeEach(() => runStore.clear());

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("cannot bypass the unlisted registry through the legacy public import", async () => {
    const response = legacyImportSuite();
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Public suite imports are disabled",
      details: {
        endpoint: "/api/suite-drafts",
        action: "Create a private draft and publish it with an unlisted capability.",
      },
    });
  });

  it("keeps an approved guest suite unlisted and capability-protected", async () => {
    const suiteId = "private-guest-route-security";
    const created = await createGuestDraft(suiteId);
    expect(created.ownerToken).toMatch(/^cs_owner_/);
    expect(created.confirmationToken).toMatch(/^cs_confirm_/);
    expect(created.draft.status).toBe("awaiting_confirmation");

    const missingOwner = await getDraft(
      new Request(`http://callsmith.test/api/suite-drafts/${created.draft.id}`),
      draftContext(created.draft.id),
    );
    const wrongOwner = await getDraft(
      new Request(`http://callsmith.test/api/suite-drafts/${created.draft.id}`, {
        headers: { authorization: "Bearer cs_owner_wrong" },
      }),
      draftContext(created.draft.id),
    );
    expect(missingOwner.status).toBe(404);
    expect(wrongOwner.status).toBe(404);
    expect(await missingOwner.json()).toEqual(await wrongOwner.json());

    const owned = await getDraft(
      new Request(`http://callsmith.test/api/suite-drafts/${created.draft.id}`, {
        headers: { authorization: `Bearer ${created.ownerToken}` },
      }),
      draftContext(created.draft.id),
    );
    expect(owned.status).toBe(200);
    expect(owned.headers.get("cache-control")).toBe("no-store, private");
    const ownedBody = await owned.json();
    expect(ownedBody).toMatchObject({
      draft: { id: created.draft.id, status: "awaiting_confirmation" },
    });
    expect(JSON.stringify(ownedBody)).not.toContain(created.ownerToken);
    expect(JSON.stringify(ownedBody)).not.toContain(created.confirmationToken);
    expect(JSON.stringify(ownedBody)).not.toContain("TokenHash");

    const approvalUrl = `http://callsmith.test/api/suite-drafts/${created.draft.id}/approve-and-run`;
    const missingConfirmation = await approveAndRun(
      jsonRequest(
        approvalUrl,
        { run: { provenance: "deterministic_preview" } },
        { authorization: `Bearer ${created.ownerToken}` },
      ),
      draftContext(created.draft.id),
    );
    const wrongConfirmation = await approveAndRun(
      jsonRequest(
        approvalUrl,
        { run: { provenance: "deterministic_preview" } },
        {
          authorization: `Bearer ${created.ownerToken}`,
          "x-callsmith-confirmation-token": "cs_confirm_wrong",
        },
      ),
      draftContext(created.draft.id),
    );
    expect(missingConfirmation.status).toBe(404);
    expect(wrongConfirmation.status).toBe(404);
    expect(await missingConfirmation.json()).toEqual(await wrongConfirmation.json());

    const wrongOwnerApproval = await approveAndRun(
      jsonRequest(
        approvalUrl,
        { run: { provenance: "deterministic_preview" } },
        {
          authorization: "Bearer cs_owner_wrong",
          "x-callsmith-confirmation-token": created.confirmationToken,
        },
      ),
      draftContext(created.draft.id),
    );
    expect(wrongOwnerApproval.status).toBe(404);

    const approved = await approveAndRun(
      jsonRequest(
        approvalUrl,
        {
          run: {
            models: ["preview"],
            repetitions: 1,
            seed: 707,
            provenance: "deterministic_preview",
            contractVariants: ["hardened"],
          },
        },
        {
          authorization: `Bearer ${created.ownerToken}`,
          "x-callsmith-confirmation-token": created.confirmationToken,
        },
      ),
      draftContext(created.draft.id),
    );
    expect(approved.status).toBe(202);
    expect(approved.headers.get("cache-control")).toBe("no-store, private");
    const approvedBody = (await approved.json()) as {
      suite: {
        id: string;
        version: string;
        immutable: boolean;
        capabilityToken: string;
      };
      run: { id: string; links: { suite: string } };
    };
    expect(approvedBody.suite).toMatchObject({
      id: suiteId,
      version: SUPPORT_ESCALATION_SUITE.version,
      immutable: true,
    });
    expect(approvedBody.suite.capabilityToken).toMatch(/^cs_suite_/);
    expect(approvedBody.run.links.suite).toContain(
      approvedBody.suite.capabilityToken,
    );
    const storedRun = runStore.get(approvedBody.run.id);
    expect(storedRun).toBeDefined();
    expect(JSON.stringify(storedRun)).not.toContain(created.ownerToken);
    expect(JSON.stringify(storedRun)).not.toContain(created.confirmationToken);
    expect(JSON.stringify(storedRun)).not.toContain(
      approvedBody.suite.capabilityToken,
    );

    const catalog = (await listPublicSuites().json()) as {
      suites: Array<{ id: string }>;
    };
    expect(catalog.suites.map((suite) => suite.id)).not.toContain(suiteId);

    for (const token of ["", "malformed", "cs_suite_wrong"]) {
      const response = await getUnlistedSuite(
        new Request(`http://callsmith.test/api/suites/unlisted/${token}`),
        unlistedContext(token),
      );
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Suite not found" });
    }

    const authorizedRead = await getUnlistedSuite(
      new Request(
        `http://callsmith.test/api/suites/unlisted/${approvedBody.suite.capabilityToken}`,
      ),
      unlistedContext(approvedBody.suite.capabilityToken),
    );
    expect(authorizedRead.status).toBe(200);
    expect(authorizedRead.headers.get("cache-control")).toBe("no-store, private");
    const authorizedBody = await authorizedRead.json();
    expect(authorizedBody).toMatchObject({
      suite: { id: suiteId, title: "Private Guest Security Suite" },
      immutable: true,
    });
    expect(JSON.stringify(authorizedBody)).not.toContain(
      approvedBody.suite.capabilityToken,
    );

    const missingCapabilityRun = await createRun(
      jsonRequest("http://callsmith.test/api/runs", {
        suiteId,
        scenarioId: "hostile-ticket-note",
        models: ["preview"],
        provenance: "deterministic_preview",
      }),
    );
    expect(missingCapabilityRun.status).toBe(404);

    const wrongCapabilityRun = await createRun(
      jsonRequest("http://callsmith.test/api/runs", {
        suiteId,
        suiteCapabilityToken: "cs_suite_wrong",
        scenarioId: "hostile-ticket-note",
        models: ["preview"],
        provenance: "deterministic_preview",
      }),
    );
    expect(wrongCapabilityRun.status).toBe(404);

    const mismatchedIdentityRun = await createRun(
      jsonRequest("http://callsmith.test/api/runs", {
        suiteId: "another-suite",
        suiteCapabilityToken: approvedBody.suite.capabilityToken,
        scenarioId: "hostile-ticket-note",
        models: ["preview"],
        provenance: "deterministic_preview",
      }),
    );
    expect(mismatchedIdentityRun.status).toBe(404);

    const authorizedRun = await createRun(
      jsonRequest("http://callsmith.test/api/runs", {
        suiteId,
        suiteVersion: SUPPORT_ESCALATION_SUITE.version,
        suiteCapabilityToken: approvedBody.suite.capabilityToken,
        scenarioId: "hostile-ticket-note",
        models: ["preview"],
        repetitions: 1,
        seed: 707,
        provenance: "deterministic_preview",
        contractVariants: ["hardened"],
      }),
    );
    expect(authorizedRun.status).toBe(202);

    const reusedApproval = await approveAndRun(
      jsonRequest(
        approvalUrl,
        { run: { provenance: "deterministic_preview" } },
        {
          authorization: `Bearer ${created.ownerToken}`,
          "x-callsmith-confirmation-token": created.confirmationToken,
        },
      ),
      draftContext(created.draft.id),
    );
    expect(reusedApproval.status).toBe(409);
    await expect(reusedApproval.json()).resolves.toEqual({
      error: "Suite draft cannot be approved",
    });
  });

  it("expires a one-time approval without publishing or running", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
    const createRunSpy = vi.spyOn(runStore, "create");
    const suiteId = "expired-guest-route-security";
    const created = await createGuestDraft(suiteId);

    vi.setSystemTime(new Date(created.confirmationExpiresAt));
    const response = await approveAndRun(
      jsonRequest(
        `http://callsmith.test/api/suite-drafts/${created.draft.id}/approve-and-run`,
        { run: { provenance: "deterministic_preview" } },
        {
          authorization: `Bearer ${created.ownerToken}`,
          "x-callsmith-confirmation-token": created.confirmationToken,
        },
      ),
      draftContext(created.draft.id),
    );
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Confirmation is no longer valid",
    });

    const catalog = (await listPublicSuites().json()) as {
      suites: Array<{ id: string }>;
    };
    expect(catalog.suites.map((suite) => suite.id)).not.toContain(suiteId);
    expect(createRunSpy).not.toHaveBeenCalled();

    const owned = await getDraft(
      new Request(`http://callsmith.test/api/suite-drafts/${created.draft.id}`, {
        headers: { authorization: `Bearer ${created.ownerToken}` },
      }),
      draftContext(created.draft.id),
    );
    await expect(owned.json()).resolves.toMatchObject({
      draft: { id: created.draft.id, status: "awaiting_confirmation" },
    });
  });
});
