import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getWorkerSuite } from "@/app/api/internal/runs/[id]/suite/route";
import { POST as createRun } from "@/app/api/runs/route";
import { POST as approveAndRun } from "@/app/api/suite-drafts/[id]/approve-and-run/route";
import { GET as getDraft } from "@/app/api/suite-drafts/[id]/route";
import { POST as createDraft } from "@/app/api/suite-drafts/route";
import { GET as listPublicSuites } from "@/app/api/suites/route";
import { GET as getUnlistedSuite } from "@/app/api/suites/unlisted/[token]/route";
import { runStore } from "@/lib/run-store";
import {
  resetSuiteRepositoryForTests,
  suiteRepository,
} from "@/lib/suite-repository";
import { SALES_GAUNTLET_SUITE } from "@/lib/suites";

let uniqueId = 0;

function privateSuite(prefix = "private-proof") {
  uniqueId += 1;
  const suite = structuredClone(SALES_GAUNTLET_SUITE);
  suite.id = `${prefix}-${uniqueId}`;
  suite.title = `Private Proof Suite ${uniqueId}`;
  return suite;
}

function jsonRequest(url: string, body: unknown, headers: HeadersInit = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function draftSuite(suite: ReturnType<typeof privateSuite>) {
  const response = await createDraft(
    jsonRequest("http://callsmith.test/api/suite-drafts", { suite }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as {
    draft: {
      id: string;
      status: string;
      confirmationExpiresAt: string;
      candidateSuite: { id: string; title: string };
    };
    ownerToken: string;
    confirmationToken: string;
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.CALLSMITH_RUNNER_TOKEN;
  runStore.clear();
  resetSuiteRepositoryForTests();
});

describe("private suite draft API", () => {
  it("rejects an oversized suite before creating a persistent draft", async () => {
    const suite = privateSuite("oversized-private-proof");
    suite.description = "x".repeat(257 * 1_024);
    const createSpy = vi.spyOn(suiteRepository, "createDraft");

    const response = await createDraft(
      jsonRequest("http://callsmith.test/api/suite-drafts", { suite }),
    );

    expect(response.status).toBe(422);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("publishes an immutable unlisted suite and runs it only through capabilities", async () => {
    const suite = privateSuite();
    const created = await draftSuite(suite);
    expect(created.draft).toMatchObject({
      status: "awaiting_confirmation",
      candidateSuite: { id: suite.id },
    });
    expect(created.ownerToken).toMatch(/^cs_owner_[A-Za-z0-9_-]{40,}$/);
    expect(created.confirmationToken).toMatch(/^cs_confirm_[A-Za-z0-9_-]{40,}$/);

    const missingOwner = await getDraft(new Request("http://callsmith.test"), {
      params: Promise.resolve({ id: created.draft.id }),
    });
    const wrongOwner = await getDraft(
      new Request("http://callsmith.test", {
        headers: { authorization: "Bearer cs_owner_wrong" },
      }),
      { params: Promise.resolve({ id: created.draft.id }) },
    );
    expect(missingOwner.status).toBe(404);
    expect(wrongOwner.status).toBe(404);
    expect(await missingOwner.text()).toBe(await wrongOwner.text());

    const owned = await getDraft(
      new Request("http://callsmith.test", {
        headers: { authorization: `Bearer ${created.ownerToken}` },
      }),
      { params: Promise.resolve({ id: created.draft.id }) },
    );
    await expect(owned.json()).resolves.toMatchObject({
      draft: { id: created.draft.id, status: "awaiting_confirmation" },
    });

    const wrongConfirmation = await approveAndRun(
      jsonRequest(
        `http://callsmith.test/api/suite-drafts/${created.draft.id}/approve-and-run`,
        {},
        {
          authorization: `Bearer ${created.ownerToken}`,
          "x-callsmith-confirmation-token": "cs_confirm_wrong",
        },
      ),
      { params: Promise.resolve({ id: created.draft.id }) },
    );
    expect(wrongConfirmation.status).toBe(404);

    const publicBefore = (await (await listPublicSuites()).json()) as {
      suites: Array<{ id: string }>;
    };
    expect(publicBefore.suites.some((item) => item.id === suite.id)).toBe(false);

    const approved = await approveAndRun(
      jsonRequest(
        `http://callsmith.test/api/suite-drafts/${created.draft.id}/approve-and-run`,
        {
          run: {
            scenarioId: "happy-path",
            models: ["preview"],
            repetitions: 1,
            seed: 101,
            provenance: "deterministic_preview",
            contractVariants: ["weak", "hardened"],
          },
        },
        {
          authorization: `Bearer ${created.ownerToken}`,
          "x-callsmith-confirmation-token": created.confirmationToken,
        },
      ),
      { params: Promise.resolve({ id: created.draft.id }) },
    );
    expect(approved.status).toBe(202);
    const approval = (await approved.json()) as {
      published: boolean;
      suite: {
        id: string;
        version: string;
        immutable: boolean;
        capabilityToken: string;
        url: string;
      };
      run: { id: string; evidenceStatus: string };
    };
    expect(approval).toMatchObject({
      published: true,
      suite: { id: suite.id, immutable: true },
      run: { evidenceStatus: "pending" },
    });
    expect(approval.suite.capabilityToken).toMatch(
      /^cs_suite_[A-Za-z0-9_-]{40,}$/,
    );
    expect(approval.suite.capabilityToken).not.toContain(suite.id);

    await vi.waitFor(() => {
      expect(runStore.get(approval.run.id)).toMatchObject({
        status: "completed",
        evidenceStatus: "conclusive",
      });
    });

    const invalidCapability = await getUnlistedSuite(
      new Request("http://callsmith.test"),
      { params: Promise.resolve({ token: "cs_suite_wrong" }) },
    );
    expect(invalidCapability.status).toBe(404);
    await expect(invalidCapability.json()).resolves.toEqual({
      error: "Suite not found",
    });

    const unlisted = await getUnlistedSuite(
      new Request("http://callsmith.test"),
      { params: Promise.resolve({ token: approval.suite.capabilityToken }) },
    );
    const firstRead = (await unlisted.json()) as {
      suite: typeof suite;
      immutable: boolean;
    };
    expect(firstRead).toMatchObject({
      suite: { id: suite.id, title: suite.title },
      immutable: true,
    });
    firstRead.suite.title = "Client-side mutation";
    const secondRead = await getUnlistedSuite(
      new Request("http://callsmith.test"),
      { params: Promise.resolve({ token: approval.suite.capabilityToken }) },
    );
    await expect(secondRead.json()).resolves.toMatchObject({
      suite: { title: suite.title },
    });

    const publicAfter = (await (await listPublicSuites()).json()) as {
      suites: Array<{ id: string }>;
    };
    expect(publicAfter.suites.some((item) => item.id === suite.id)).toBe(false);

    const noCapabilityRun = await createRun(
      jsonRequest("http://callsmith.test/api/runs", {
        suiteId: suite.id,
        scenarioId: "happy-path",
        provenance: "deterministic_preview",
      }),
    );
    const wrongCapabilityRun = await createRun(
      jsonRequest("http://callsmith.test/api/runs", {
        suiteId: suite.id,
        suiteCapabilityToken: "cs_suite_wrong",
        scenarioId: "happy-path",
        provenance: "deterministic_preview",
      }),
    );
    expect(noCapabilityRun.status).toBe(404);
    expect(wrongCapabilityRun.status).toBe(404);
    expect(await noCapabilityRun.text()).toBe(await wrongCapabilityRun.text());

    const capabilityRun = await createRun(
      jsonRequest("http://callsmith.test/api/runs", {
        suiteId: suite.id,
        suiteCapabilityToken: approval.suite.capabilityToken,
        scenarioId: "happy-path",
        models: ["preview"],
        provenance: "deterministic_preview",
        contractVariants: ["hardened"],
      }),
    );
    expect(capabilityRun.status).toBe(202);
    const privateRun = (await capabilityRun.json()) as {
      id: string;
      links: { suite: string; sandbox?: string };
    };
    expect(privateRun.links).toEqual({
      self: `/api/runs/${privateRun.id}`,
      events: `/api/runs/${privateRun.id}/events`,
      suite: approval.suite.url,
    });
    expect(privateRun.links.sandbox).toBeUndefined();

    process.env.CALLSMITH_RUNNER_TOKEN = "runner-secret";
    const unauthorizedWorker = await getWorkerSuite(
      new Request("http://callsmith.test"),
      { params: Promise.resolve({ id: privateRun.id }) },
    );
    expect(unauthorizedWorker.status).toBe(401);
    const workerSuite = await getWorkerSuite(
      new Request("http://callsmith.test", {
        headers: { authorization: "Bearer runner-secret" },
      }),
      { params: Promise.resolve({ id: privateRun.id }) },
    );
    await expect(workerSuite.json()).resolves.toMatchObject({
      suite: { id: suite.id },
      scenario: { id: "happy-path" },
    });

    const secondApproval = await approveAndRun(
      jsonRequest(
        `http://callsmith.test/api/suite-drafts/${created.draft.id}/approve-and-run`,
        {},
        {
          authorization: `Bearer ${created.ownerToken}`,
          "x-callsmith-confirmation-token": created.confirmationToken,
        },
      ),
      { params: Promise.resolve({ id: created.draft.id }) },
    );
    expect(secondApproval.status).toBe(409);
    await expect(secondApproval.json()).resolves.toEqual({
      error: "Suite draft cannot be approved",
    });
  });

  it("rejects an expired confirmation without publishing or leaking the suite", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
    const suite = privateSuite("expired-proof");
    const created = await draftSuite(suite);
    vi.advanceTimersByTime(5 * 60 * 1_000);

    const expired = await approveAndRun(
      jsonRequest(
        `http://callsmith.test/api/suite-drafts/${created.draft.id}/approve-and-run`,
        {},
        {
          authorization: `Bearer ${created.ownerToken}`,
          "x-callsmith-confirmation-token": created.confirmationToken,
        },
      ),
      { params: Promise.resolve({ id: created.draft.id }) },
    );
    expect(expired.status).toBe(410);
    await expect(expired.json()).resolves.toEqual({
      error: "Confirmation is no longer valid",
    });

    const publicSuites = (await (await listPublicSuites()).json()) as {
      suites: Array<{ id: string }>;
    };
    expect(publicSuites.suites.some((item) => item.id === suite.id)).toBe(false);
  });

  it("publishes truthfully but defaults the run to browser WebMCP when provenance is omitted", async () => {
    const suite = privateSuite("browser-default-proof");
    const created = await draftSuite(suite);
    const previousRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;

    try {
      const approved = await approveAndRun(
        jsonRequest(
          `http://callsmith.test/api/suite-drafts/${created.draft.id}/approve-and-run`,
          { run: { scenarioId: "happy-path" } },
          {
            authorization: `Bearer ${created.ownerToken}`,
            "x-callsmith-confirmation-token": created.confirmationToken,
          },
        ),
        { params: Promise.resolve({ id: created.draft.id }) },
      );

      expect(approved.status).toBe(503);
      await expect(approved.json()).resolves.toMatchObject({
        published: true,
        suite: { id: suite.id, immutable: true },
        run: {
          error: "Browser-native runner queue is not configured",
          details: { code: "BROWSER_QUEUE_REQUIRED" },
        },
      });
    } finally {
      if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previousRedisUrl;
    }
  });
});
