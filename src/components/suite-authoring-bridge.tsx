"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { GuidedSuiteReview } from "@/components/guided-suite-review";
import { suiteAuthoringTools } from "@/components/suite-authoring-tools";
import {
  ConfirmationCoordinator,
  ConfirmationTransportError,
  createHumanDecisionAuthority,
  type ConfirmationCoordinatorSnapshot,
  type ConfirmationDecision,
  type ConfirmationDraftChallenge,
  type ConfirmationRunOptions,
  type ConfirmationRunReceipt,
  type ConfirmationTransport,
} from "@/lib/confirmation-coordinator";
import {
  GuidedSuiteDraftSchema,
  SuiteDefinitionV2Schema,
  type GuidedSuiteDraft,
} from "@/lib/contracts";
import { registerWebMcpTools } from "@/lib/webmcp";

type BrowserCapabilityHandle = {
  ownerToken: string;
  confirmationToken: string;
  approveAndRunPath: string;
  rejectPath: string;
};

type JsonRecord = Record<string, unknown>;

function objectValue(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

async function responseBody(response: Response): Promise<JsonRecord> {
  try {
    return objectValue(await response.json()) ?? {};
  } catch {
    return {};
  }
}

function transportFailure(response: Response): ConfirmationTransportError {
  if (response.status === 410) return new ConfirmationTransportError("stale_draft");
  if (response.status === 409 || response.status === 404) {
    return new ConfirmationTransportError("draft_conflict");
  }
  return new ConfirmationTransportError("unavailable");
}

const browserConfirmationTransport: ConfirmationTransport<BrowserCapabilityHandle> = {
  async createDraft(draft): Promise<ConfirmationDraftChallenge<BrowserCapabilityHandle>> {
    // Do not bind creation to the agent's cancellation signal. If cancellation
    // races the HTTP response, the coordinator can still use the returned
    // owner capability to reject the detached server draft.
    const response = await fetch("/api/suite-drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft }),
      cache: "no-store",
    });
    const body = await responseBody(response);
    if (!response.ok) throw transportFailure(response);

    const draftRecord = objectValue(body.draft);
    const links = objectValue(body.links);
    const ownerToken = body.ownerToken;
    const confirmationToken = body.confirmationToken;
    const expiresAt = body.confirmationExpiresAt;
    const suite = SuiteDefinitionV2Schema.safeParse(draftRecord?.candidateSuite);
    if (
      typeof draftRecord?.id !== "string" ||
      typeof ownerToken !== "string" ||
      typeof confirmationToken !== "string" ||
      typeof expiresAt !== "string" ||
      typeof links?.approveAndRun !== "string" ||
      typeof links?.reject !== "string" ||
      !suite.success
    ) {
      throw new ConfirmationTransportError("invalid_response");
    }

    return {
      draftId: draftRecord.id,
      expiresAt,
      suite: suite.data,
      handle: {
        ownerToken,
        confirmationToken,
        approveAndRunPath: links.approveAndRun,
        rejectPath: links.reject,
      },
    };
  },

  async approveAndRun({
    handle,
    run,
    signal,
  }): Promise<ConfirmationRunReceipt> {
    const response = await fetch(handle.approveAndRunPath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${handle.ownerToken}`,
        "x-callsmith-confirmation-token": handle.confirmationToken,
      },
      body: JSON.stringify({ run }),
      cache: "no-store",
      signal,
    });
    const body = await responseBody(response);
    if (!response.ok) throw transportFailure(response);
    const runRecord = objectValue(body.run);
    const reportRecord = objectValue(body.report);
    if (typeof runRecord?.id !== "string" || typeof runRecord.status !== "string") {
      throw new ConfirmationTransportError("invalid_response");
    }
    if (
      !["queued", "running", "completed", "partial_failure", "failed"].includes(
        runRecord.status,
      )
    ) {
      throw new ConfirmationTransportError("invalid_response");
    }
    return {
      runId: runRecord.id,
      runStatus: runRecord.status as ConfirmationRunReceipt["runStatus"],
      ...(typeof reportRecord?.path === "string"
        ? { reportPath: reportRecord.path }
        : {}),
    };
  },

  async rejectDraft({ handle, signal }): Promise<void> {
    const response = await fetch(handle.rejectPath, {
      method: "POST",
      headers: { authorization: `Bearer ${handle.ownerToken}` },
      cache: "no-store",
      signal,
      keepalive: true,
    });
    if (!response.ok) throw transportFailure(response);
  },
};

function coordinatorStatus(
  snapshot: ConfirmationCoordinatorSnapshot,
): "pending" | "approving" | "rejecting" {
  if (snapshot.phase === "approving") return "approving";
  if (snapshot.phase === "rejecting") return "rejecting";
  return "pending";
}

/**
 * Registers the authoring tools and owns the human-only approval surface. Raw
 * capabilities live exclusively inside the coordinator's private transport
 * handle; they never enter React state, the DOM, tool output, or storage.
 */
export function SuiteAuthoringBridge() {
  const mountedRef = useRef(false);
  const [{ authority, coordinator }] = useState(() => {
    const authority = createHumanDecisionAuthority();
    const coordinator = new ConfirmationCoordinator<BrowserCapabilityHandle>({
      transport: browserConfirmationTransport,
      verifyHumanDecision: authority.verify,
    });
    return { authority, coordinator };
  });
  const [snapshot, setSnapshot] = useState<ConfirmationCoordinatorSnapshot>(
    coordinator.getSnapshot(),
  );
  const [reviewedDraft, setReviewedDraft] = useState<GuidedSuiteDraft>();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // React development mode replays effects once. Deferring disposal by a
      // microtask distinguishes that replay from a real route unmount.
      queueMicrotask(() => {
        if (!mountedRef.current) void coordinator.dispose();
      });
    };
  }, [coordinator]);

  useEffect(
    () => coordinator.subscribe(() => setSnapshot(coordinator.getSnapshot())),
    [coordinator],
  );

  useEffect(() => {
    const stopForNavigation = () => {
      void coordinator.abort("navigation");
    };
    const reconcileExpiry = () => {
      if (document.visibilityState === "visible") {
        void coordinator.checkForStaleDraft();
      }
    };
    window.addEventListener("pagehide", stopForNavigation);
    document.addEventListener("visibilitychange", reconcileExpiry);
    return () => {
      window.removeEventListener("pagehide", stopForNavigation);
      document.removeEventListener("visibilitychange", reconcileExpiry);
    };
  }, [coordinator]);

  const requestHumanReview = useCallback(
    async (input: Record<string, unknown>, signal: AbortSignal) => {
      const parsed = GuidedSuiteDraftSchema.safeParse(input);
      if (parsed.success) setReviewedDraft(parsed.data);
      const run: ConfirmationRunOptions = {
        models: ["gpt-5.6-luna"],
        contractVariants: ["weak", "hardened"],
        repetitions: 1,
        seed: parsed.success ? parsed.data.seed : undefined,
        provenance: "browser_webmcp",
      };
      return coordinator.requestReview(input, { signal, run });
    },
    [coordinator],
  );

  useEffect(() => {
    const registration = registerWebMcpTools(
      suiteAuthoringTools(requestHumanReview),
    );
    return registration.unregister;
  }, [requestHumanReview]);

  async function recordDecision(decision: ConfirmationDecision) {
    const evidence = authority.issue();
    const receipt =
      decision === "approve"
        ? await coordinator.approve(evidence)
        : await coordinator.reject(evidence);
    if (!receipt.accepted) {
      throw new Error(
        receipt.reason === "stale_draft"
          ? "This review expired. Create a fresh draft."
          : "This human decision was not accepted. No run was started.",
      );
    }
  }

  const reviewOpen =
    reviewedDraft &&
    (snapshot.phase === "pending_review" ||
      snapshot.phase === "approving" ||
      snapshot.phase === "rejecting");

  return reviewOpen ? (
    <GuidedSuiteReview
      draft={reviewedDraft}
      compiledSuite={snapshot.suite}
      status={coordinatorStatus(snapshot)}
      onApprove={() => recordDecision("approve")}
      onReject={() => recordDecision("reject")}
      onDismiss={() => void coordinator.abort("aborted")}
    />
  ) : null;
}

export default SuiteAuthoringBridge;
