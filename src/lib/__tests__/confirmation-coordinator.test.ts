import { describe, expect, it, vi } from "vitest";

import { GuidedSuiteDraftSchema } from "@/lib/contracts";
import {
  ConfirmationCoordinator,
  ConfirmationTransportError,
  createHumanDecisionAuthority,
  type ConfirmationDraftChallenge,
  type ConfirmationRunReceipt,
  type ConfirmationTransport,
} from "@/lib/confirmation-coordinator";
import { compileGuidedSuiteDraft } from "@/lib/suite-compiler";
import salesDraftInput from "../../../tests/fixtures/guided-suite/sales.json";

type SecretHandle = {
  ownerCapability: string;
  confirmationCapability: string;
};

const OWNER_SECRET = "cs_owner_should_never_escape";
const CONFIRMATION_SECRET = "cs_confirm_should_never_escape";
const HUMAN_AUTHORITY = Object.freeze({ kind: "trusted-click-authority" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const draft = GuidedSuiteDraftSchema.parse(salesDraftInput);
  return { draft, suite: compileGuidedSuiteDraft(draft) };
}

function challenge(now: number): ConfirmationDraftChallenge<SecretHandle> {
  const { suite } = fixture();
  return {
    draftId: "draft-review-001",
    expiresAt: new Date(now + 60_000).toISOString(),
    suite,
    handle: {
      ownerCapability: OWNER_SECRET,
      confirmationCapability: CONFIRMATION_SECRET,
    },
  };
}

function harness(overrides: {
  now?: () => number;
  createDraft?: ConfirmationTransport<SecretHandle>["createDraft"];
  approveAndRun?: ConfirmationTransport<SecretHandle>["approveAndRun"];
  rejectDraft?: ConfirmationTransport<SecretHandle>["rejectDraft"];
} = {}) {
  let now = Date.parse("2026-08-27T12:00:00.000Z");
  const scheduled: Array<{ callback: () => void; cancelled: boolean }> = [];
  const transport: ConfirmationTransport<SecretHandle> = {
    createDraft:
      overrides.createDraft ??
      vi.fn(async () => challenge(overrides.now?.() ?? now)),
    approveAndRun:
      overrides.approveAndRun ??
      vi.fn(async (): Promise<ConfirmationRunReceipt> => ({
        runId: "run-approved-001",
        runStatus: "queued",
        reportPath: "/r/report-token",
      })),
    rejectDraft: overrides.rejectDraft ?? vi.fn(async () => undefined),
  };
  const verifyHumanDecision = vi.fn(
    (evidence: unknown) => evidence === HUMAN_AUTHORITY,
  );
  const coordinator = new ConfirmationCoordinator<SecretHandle>({
    transport,
    verifyHumanDecision,
    now: overrides.now ?? (() => now),
    createRequestId: () => "review-request-001",
    schedule: (callback) => {
      const entry = { callback, cancelled: false };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  });
  return {
    coordinator,
    transport,
    verifyHumanDecision,
    scheduled,
    setNow(value: number) {
      now = value;
    },
  };
}

async function waitForPhase(
  coordinator: ConfirmationCoordinator<SecretHandle>,
  phase: ReturnType<ConfirmationCoordinator<SecretHandle>["getSnapshot"]>["phase"],
) {
  await vi.waitFor(() => expect(coordinator.getSnapshot().phase).toBe(phase));
}

function expectNoCapabilities(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(OWNER_SECRET);
  expect(serialized).not.toContain(CONFIRMATION_SECRET);
  expect(serialized).not.toMatch(/ownerCapability|confirmationCapability/);
}

describe("ConfirmationCoordinator", () => {
  it("issues single-use in-memory evidence for trusted UI event handlers", () => {
    const authority = createHumanDecisionAuthority();
    const evidence = authority.issue();

    expect(authority.verify({ source: "agent" })).toBe(false);
    expect(authority.verify(evidence)).toBe(true);
    expect(authority.verify(evidence)).toBe(false);
    expect(JSON.stringify(authority)).not.toContain("capability");
  });

  it("opens an explicit pending review without exposing or persisting capabilities", async () => {
    const { draft, suite } = fixture();
    const { coordinator, transport } = harness();
    const result = coordinator.requestReview(draft);

    expect(coordinator.getSnapshot()).toEqual({
      phase: "creating_draft",
      requestId: "review-request-001",
    });
    await waitForPhase(coordinator, "pending_review");

    expect(coordinator.getSnapshot()).toMatchObject({
      phase: "pending_review",
      requestId: "review-request-001",
      draftId: "draft-review-001",
      suite,
    });
    expectNoCapabilities(coordinator.getSnapshot());
    expectNoCapabilities(coordinator);
    expect(transport.approveAndRun).not.toHaveBeenCalled();

    await coordinator.abort();
    await expect(result).resolves.toMatchObject({ status: "aborted" });
  });

  it("rejects agent-supplied approval fields before creating a draft", async () => {
    const { draft } = fixture();
    const { coordinator, transport, verifyHumanDecision } = harness();
    const result = await coordinator.requestReview({ ...draft, approved: true });

    expect(result).toMatchObject({
      ok: false,
      status: "invalid_request",
      code: "invalid_draft",
    });
    expect(transport.createDraft).not.toHaveBeenCalled();
    expect(transport.approveAndRun).not.toHaveBeenCalled();
    expect(verifyHumanDecision).not.toHaveBeenCalled();
  });

  it("requires trusted human evidence and returns only a safe approved result", async () => {
    const { draft } = fixture();
    const approveAndRun = vi.fn(async () =>
      ({
        runId: "run-approved-001",
        runStatus: "queued",
        reportPath: "/r/read-only-report",
        capabilityToken: "cs_suite_must_be_dropped",
        ownerCapability: OWNER_SECRET,
      }) as ConfirmationRunReceipt,
    );
    const { coordinator, transport } = harness({ approveAndRun });
    const result = coordinator.requestReview(draft);
    await waitForPhase(coordinator, "pending_review");

    await expect(coordinator.approve(true)).resolves.toEqual({
      accepted: false,
      reason: "untrusted_evidence",
    });
    await expect(coordinator.approve({ source: "agent" })).resolves.toEqual({
      accepted: false,
      reason: "untrusted_evidence",
    });
    expect(transport.approveAndRun).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot().phase).toBe("pending_review");

    await expect(coordinator.approve(HUMAN_AUTHORITY)).resolves.toEqual({
      accepted: true,
      requestId: "review-request-001",
      decision: "approve",
    });
    const terminal = await result;
    expect(terminal).toEqual({
      ok: true,
      status: "approved",
      message: "The human approved this exact suite and the comparison was started.",
      run: {
        runId: "run-approved-001",
        runStatus: "queued",
        reportPath: "/r/read-only-report",
      },
    });
    expectNoCapabilities(terminal);
    expectNoCapabilities(coordinator.getSnapshot());
    expect(transport.approveAndRun).toHaveBeenCalledTimes(1);
  });

  it("rejects without publishing or starting a run and guards duplicate decisions", async () => {
    const { draft } = fixture();
    const { coordinator, transport } = harness();
    const result = coordinator.requestReview(draft);
    await waitForPhase(coordinator, "pending_review");

    await expect(coordinator.reject(HUMAN_AUTHORITY)).resolves.toMatchObject({
      accepted: true,
      decision: "reject",
    });
    await expect(result).resolves.toMatchObject({
      ok: false,
      status: "rejected",
      code: "human_rejected",
    });
    expect(transport.rejectDraft).toHaveBeenCalledTimes(1);
    expect(transport.approveAndRun).not.toHaveBeenCalled();

    await expect(coordinator.reject(HUMAN_AUTHORITY)).resolves.toEqual({
      accepted: false,
      reason: "decision_already_taken",
    });
    expect(transport.rejectDraft).toHaveBeenCalledTimes(1);
  });

  it("locks the first human decision while approval is in flight", async () => {
    const { draft } = fixture();
    const approval = deferred<ConfirmationRunReceipt>();
    const approveAndRun = vi.fn(() => approval.promise);
    const { coordinator, transport } = harness({ approveAndRun });
    const result = coordinator.requestReview(draft);
    await waitForPhase(coordinator, "pending_review");

    const first = coordinator.approve(HUMAN_AUTHORITY);
    expect(coordinator.getSnapshot().phase).toBe("approving");
    await expect(coordinator.reject(HUMAN_AUTHORITY)).resolves.toEqual({
      accepted: false,
      reason: "decision_already_taken",
    });
    await expect(coordinator.approve(HUMAN_AUTHORITY)).resolves.toEqual({
      accepted: false,
      reason: "decision_already_taken",
    });
    expect(transport.approveAndRun).toHaveBeenCalledTimes(1);
    expect(transport.rejectDraft).not.toHaveBeenCalled();

    approval.resolve({ runId: "run-one-decision", runStatus: "queued" });
    await expect(first).resolves.toMatchObject({ accepted: true, decision: "approve" });
    await expect(result).resolves.toMatchObject({ status: "approved" });
  });

  it("aborts on navigation, rejects the server draft, and resolves a safe terminal result", async () => {
    const { draft } = fixture();
    const { coordinator, transport } = harness();
    const result = coordinator.requestReview(draft);
    await waitForPhase(coordinator, "pending_review");

    await expect(coordinator.abort("navigation")).resolves.toBe(true);
    await expect(result).resolves.toEqual({
      ok: false,
      status: "aborted",
      code: "navigation",
      message: "The review was closed during navigation. No approval was sent.",
    });
    expect(transport.rejectDraft).toHaveBeenCalledTimes(1);
    expect(transport.approveAndRun).not.toHaveBeenCalled();
    expectNoCapabilities(coordinator.getSnapshot());
  });

  it("cleans up a challenge that arrives after the agent aborts creation", async () => {
    const { draft } = fixture();
    const now = Date.parse("2026-08-27T12:00:00.000Z");
    const creation = deferred<ConfirmationDraftChallenge<SecretHandle>>();
    const createDraft = vi.fn(() => creation.promise);
    const { coordinator, transport } = harness({ createDraft, now: () => now });
    const controller = new AbortController();
    const result = coordinator.requestReview(draft, { signal: controller.signal });

    controller.abort();
    await expect(result).resolves.toMatchObject({ status: "aborted" });
    creation.resolve(challenge(now));
    await vi.waitFor(() => expect(transport.rejectDraft).toHaveBeenCalledTimes(1));
    expect(coordinator.getSnapshot().phase).toBe("terminal");
    expect(transport.approveAndRun).not.toHaveBeenCalled();
  });

  it("disposes permanently on unmount/navigation and performs cleanup", async () => {
    const { draft } = fixture();
    const { coordinator, transport } = harness();
    const result = coordinator.requestReview(draft);
    await waitForPhase(coordinator, "pending_review");

    await coordinator.dispose();
    expect(coordinator.getSnapshot()).toEqual({ phase: "disposed" });
    await expect(result).resolves.toMatchObject({ status: "aborted", code: "navigation" });
    expect(transport.rejectDraft).toHaveBeenCalledTimes(1);

    await expect(coordinator.requestReview(draft)).resolves.toMatchObject({
      status: "disposed",
      code: "coordinator_disposed",
    });
  });

  it("expires stale reviews, performs cleanup, and refuses late approval", async () => {
    const { draft } = fixture();
    let now = Date.parse("2026-08-27T12:00:00.000Z");
    const { coordinator, transport, setNow } = harness({ now: () => now });
    const result = coordinator.requestReview(draft);
    await waitForPhase(coordinator, "pending_review");

    now += 60_001;
    setNow(now);
    await expect(coordinator.checkForStaleDraft()).resolves.toBe(true);
    await expect(result).resolves.toMatchObject({
      status: "stale_draft",
      code: "stale_draft",
    });
    expect(transport.rejectDraft).toHaveBeenCalledTimes(1);
    expect(transport.approveAndRun).not.toHaveBeenCalled();
    await expect(coordinator.approve(HUMAN_AUTHORITY)).resolves.toEqual({
      accepted: false,
      reason: "decision_already_taken",
    });
  });

  it("maps stale server decisions and malformed receipts to capability-free failures", async () => {
    const { draft } = fixture();
    const stale = harness({
      approveAndRun: vi.fn(async () => {
        throw new ConfirmationTransportError("stale_draft");
      }),
    });
    const staleResult = stale.coordinator.requestReview(draft);
    await waitForPhase(stale.coordinator, "pending_review");
    await stale.coordinator.approve(HUMAN_AUTHORITY);
    await expect(staleResult).resolves.toMatchObject({ status: "stale_draft" });
    expect(stale.transport.rejectDraft).toHaveBeenCalledTimes(1);

    const malformed = harness({
      approveAndRun: vi.fn(async (): Promise<ConfirmationRunReceipt> => ({
        runId: OWNER_SECRET,
        runStatus: "queued",
        reportPath: `/api/suites/unlisted/${CONFIRMATION_SECRET}`,
      })),
    });
    const malformedResult = malformed.coordinator.requestReview(draft);
    await waitForPhase(malformed.coordinator, "pending_review");
    await malformed.coordinator.approve(HUMAN_AUTHORITY);
    const terminal = await malformedResult;
    expect(terminal).toMatchObject({ status: "failed", code: "approval_interrupted" });
    expectNoCapabilities(terminal);
    expectNoCapabilities(malformed.coordinator.getSnapshot());
  });

  it("keeps the active review while returning a safe busy result for a second agent call", async () => {
    const { draft } = fixture();
    const { coordinator, transport } = harness();
    const first = coordinator.requestReview(draft);
    await waitForPhase(coordinator, "pending_review");

    await expect(coordinator.requestReview(draft)).resolves.toEqual({
      ok: false,
      status: "busy",
      code: "review_in_progress",
      message: "Another draft is already waiting for a human decision.",
    });
    expect(coordinator.getSnapshot().phase).toBe("pending_review");
    expect(transport.createDraft).toHaveBeenCalledTimes(1);

    await coordinator.reject(HUMAN_AUTHORITY);
    await first;
  });
});
