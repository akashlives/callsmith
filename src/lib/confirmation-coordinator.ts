import { z } from "zod";

import {
  GuidedSuiteDraftSchema,
  SuiteDefinitionV2Schema,
  type GuidedSuiteDraft,
  type SuiteDefinitionV2,
} from "@/lib/contracts";

export type ConfirmationDecision = "approve" | "reject";
export type ConfirmationAbortReason = "aborted" | "navigation";

export interface ConfirmationRunOptions {
  models?: Array<"gpt-5.6-luna" | "gpt-5.6-terra">;
  repetitions?: number;
  seed?: number;
  provenance?: "browser_webmcp" | "server_simulation" | "deterministic_preview";
  contractVariants?: Array<"weak" | "hardened">;
}

export const ConfirmationRunOptionsSchema = z
  .object({
    models: z
      .array(z.enum(["gpt-5.6-luna", "gpt-5.6-terra"]))
      .min(1)
      .max(2)
      .optional(),
    repetitions: z.number().int().min(1).max(10).optional(),
    seed: z.number().int().optional(),
    provenance: z
      .enum(["browser_webmcp", "server_simulation", "deterministic_preview"])
      .optional(),
    contractVariants: z
      .array(z.enum(["weak", "hardened"]))
      .min(1)
      .max(2)
      .optional(),
  })
  .strict();

export interface ConfirmationDraftChallenge<THandle> {
  draftId: string;
  expiresAt: string;
  suite: SuiteDefinitionV2;
  /**
   * Opaque, private transport state. An HTTP adapter can keep owner and
   * confirmation capabilities here; the coordinator never returns or
   * serializes it.
   */
  handle: THandle;
}

export interface ConfirmationRunReceipt {
  runId: string;
  runStatus: "queued" | "running" | "completed" | "partial_failure" | "failed";
  reportPath?: string;
}

export interface ConfirmationTransport<THandle> {
  createDraft(
    draft: GuidedSuiteDraft,
    options: { signal: AbortSignal },
  ): Promise<ConfirmationDraftChallenge<THandle>>;
  approveAndRun(options: {
    draftId: string;
    handle: THandle;
    run: ConfirmationRunOptions;
    signal: AbortSignal;
  }): Promise<ConfirmationRunReceipt>;
  rejectDraft(options: {
    draftId: string;
    handle: THandle;
    signal: AbortSignal;
  }): Promise<void>;
}

export type ConfirmationTransportErrorCode =
  | "stale_draft"
  | "draft_conflict"
  | "invalid_response"
  | "unavailable";

/** Transport adapters translate server failures to these non-sensitive codes. */
export class ConfirmationTransportError extends Error {
  constructor(public readonly code: ConfirmationTransportErrorCode) {
    super(
      code === "stale_draft" || code === "draft_conflict"
        ? "The draft is no longer eligible for this decision."
        : "The confirmation service could not complete the request.",
    );
    this.name = "ConfirmationTransportError";
  }
}

export type ConfirmationTerminalResult =
  | {
      ok: true;
      status: "approved";
      message: string;
      run: ConfirmationRunReceipt;
    }
  | {
      ok: false;
      status:
        | "rejected"
        | "aborted"
        | "stale_draft"
        | "invalid_request"
        | "busy"
        | "failed"
        | "disposed";
      code:
        | "human_rejected"
        | "request_aborted"
        | "navigation"
        | "stale_draft"
        | "invalid_draft"
        | "review_in_progress"
        | "approval_interrupted"
        | "transport_failure"
        | "coordinator_disposed";
      message: string;
    };

export interface ConfirmationReviewSnapshot {
  requestId: string;
  draftId: string;
  expiresAt: string;
  suite: SuiteDefinitionV2;
}

export type ConfirmationCoordinatorSnapshot =
  | { phase: "idle" }
  | { phase: "creating_draft"; requestId: string }
  | ({ phase: "pending_review" } & ConfirmationReviewSnapshot)
  | ({ phase: "approving" } & ConfirmationReviewSnapshot)
  | ({ phase: "rejecting" } & ConfirmationReviewSnapshot)
  | { phase: "terminal"; requestId: string; result: ConfirmationTerminalResult }
  | { phase: "disposed" };

export type HumanDecisionReceipt =
  | { accepted: true; requestId: string; decision: ConfirmationDecision }
  | {
      accepted: false;
      reason:
        | "untrusted_evidence"
        | "no_pending_review"
        | "decision_already_taken"
        | "stale_draft"
        | "disposed";
    };

export interface ConfirmationCoordinatorOptions<THandle> {
  transport: ConfirmationTransport<THandle>;
  /**
   * Required authority boundary. The integration should verify an object held
   * only by its trusted click/form handler; booleans or agent arguments are
   * never accepted as evidence by the coordinator.
   */
  verifyHumanDecision: (
    evidence: unknown,
    decision: ConfirmationDecision,
    review: ConfirmationReviewSnapshot,
  ) => boolean;
  now?: () => number;
  createRequestId?: () => string;
  schedule?: (callback: () => void, delayMs: number) => () => void;
}

export interface RequestReviewOptions {
  signal?: AbortSignal;
  run?: ConfirmationRunOptions;
}

export interface HumanDecisionAuthority {
  /** Call only inside the trusted human click/form handler. */
  issue: () => object;
  /** Pass directly to ConfirmationCoordinator.verifyHumanDecision. */
  verify: (evidence: unknown) => boolean;
}

/**
 * Creates single-use, in-memory evidence for a trusted UI event handler. It
 * serializes to no capability and has no agent-facing approval parameter.
 */
export function createHumanDecisionAuthority(): HumanDecisionAuthority {
  const issued = new WeakSet<object>();
  return Object.freeze({
    issue: () => {
      const evidence = Object.freeze(Object.create(null)) as object;
      issued.add(evidence);
      return evidence;
    },
    verify: (evidence: unknown) => {
      if (!evidence || typeof evidence !== "object" || !issued.has(evidence)) {
        return false;
      }
      issued.delete(evidence);
      return true;
    },
  });
}

type SessionDecision = ConfirmationDecision | ConfirmationAbortReason;

interface ActiveSession<THandle> {
  requestId: string;
  draft: GuidedSuiteDraft;
  run: ConfirmationRunOptions;
  controller: AbortController;
  result: Promise<ConfirmationTerminalResult>;
  resolve: (result: ConfirmationTerminalResult) => void;
  settled: boolean;
  decision?: SessionDecision;
  draftId?: string;
  expiresAt?: string;
  expiresAtMs?: number;
  suite?: SuiteDefinitionV2;
  handle?: THandle;
  removeExternalAbort?: () => void;
  cancelExpiry?: () => void;
}

const defaultSchedule = (callback: () => void, delayMs: number): (() => void) => {
  const timeout = setTimeout(callback, delayMs);
  return () => clearTimeout(timeout);
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function safeRunReceipt(input: ConfirmationRunReceipt): ConfirmationRunReceipt | undefined {
  const statuses = new Set([
    "queued",
    "running",
    "completed",
    "partial_failure",
    "failed",
  ]);
  if (
    !input ||
    typeof input.runId !== "string" ||
    !/^run-[A-Za-z0-9-]{1,190}$/.test(input.runId) ||
    !statuses.has(input.runStatus)
  ) {
    return undefined;
  }
  const reportPath = input.reportPath;
  if (
    reportPath !== undefined &&
    !/^\/r\/[A-Za-z0-9._~-]{1,500}$/.test(reportPath)
  ) {
    return undefined;
  }
  return deepFreeze({
    runId: input.runId,
    runStatus: input.runStatus,
    ...(reportPath ? { reportPath } : {}),
  });
}

function abortedResult(reason: ConfirmationAbortReason): ConfirmationTerminalResult {
  return deepFreeze({
    ok: false,
    status: "aborted",
    code: reason === "navigation" ? "navigation" : "request_aborted",
    message:
      reason === "navigation"
        ? "The review was closed during navigation. No approval was sent."
        : "The review was cancelled. No approval was sent.",
  });
}

function staleResult(): ConfirmationTerminalResult {
  return deepFreeze({
    ok: false,
    status: "stale_draft",
    code: "stale_draft",
    message: "This draft expired or changed before approval. Create a fresh review.",
  });
}

function transportFailure(approvalInterrupted = false): ConfirmationTerminalResult {
  return deepFreeze({
    ok: false,
    status: "failed",
    code: approvalInterrupted ? "approval_interrupted" : "transport_failure",
    message: approvalInterrupted
      ? "Approval was interrupted. Verify the draft status before retrying."
      : "The review could not be completed. No approval result was accepted.",
  });
}

/**
 * Coordinates one agent-authored draft at a time. The agent-facing request
 * only accepts a strict GuidedSuiteDraft. Human decisions travel through a
 * separate, injected authority check and opaque transport state never enters a
 * public snapshot or terminal tool result.
 */
export class ConfirmationCoordinator<THandle = unknown> {
  readonly #transport: ConfirmationTransport<THandle>;
  readonly #verifyHumanDecision: ConfirmationCoordinatorOptions<THandle>["verifyHumanDecision"];
  readonly #now: () => number;
  readonly #createRequestId: () => string;
  readonly #schedule: NonNullable<ConfirmationCoordinatorOptions<THandle>["schedule"]>;
  readonly #listeners = new Set<() => void>();
  #snapshot: ConfirmationCoordinatorSnapshot = deepFreeze({ phase: "idle" });
  #active?: ActiveSession<THandle>;
  #disposed = false;
  #sequence = 0;

  constructor(options: ConfirmationCoordinatorOptions<THandle>) {
    this.#transport = options.transport;
    this.#verifyHumanDecision = options.verifyHumanDecision;
    this.#now = options.now ?? Date.now;
    this.#createRequestId =
      options.createRequestId ?? (() => `review-${++this.#sequence}`);
    this.#schedule = options.schedule ?? defaultSchedule;
  }

  getSnapshot = (): ConfirmationCoordinatorSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  requestReview(
    input: unknown,
    options: RequestReviewOptions = {},
  ): Promise<ConfirmationTerminalResult> {
    if (this.#disposed) {
      return Promise.resolve(
        deepFreeze({
          ok: false,
          status: "disposed",
          code: "coordinator_disposed",
          message: "This review surface is no longer active.",
        }),
      );
    }
    if (this.#active && !this.#active.settled) {
      return Promise.resolve(
        deepFreeze({
          ok: false,
          status: "busy",
          code: "review_in_progress",
          message: "Another draft is already waiting for a human decision.",
        }),
      );
    }

    const parsed = GuidedSuiteDraftSchema.safeParse(input);
    const parsedRun = ConfirmationRunOptionsSchema.safeParse(options.run ?? {});
    const requestId = this.#createRequestId();
    if (!parsed.success || !parsedRun.success) {
      const result: ConfirmationTerminalResult = deepFreeze({
        ok: false,
        status: "invalid_request",
        code: "invalid_draft",
        message: "The submitted draft is invalid and was not opened for review.",
      });
      this.#setSnapshot({ phase: "terminal", requestId, result });
      return Promise.resolve(result);
    }
    if (options.signal?.aborted) {
      const result = abortedResult("aborted");
      this.#setSnapshot({ phase: "terminal", requestId, result });
      return Promise.resolve(result);
    }

    let resolve!: (result: ConfirmationTerminalResult) => void;
    const result = new Promise<ConfirmationTerminalResult>((complete) => {
      resolve = complete;
    });
    const session: ActiveSession<THandle> = {
      requestId,
      draft: parsed.data,
      run: deepFreeze(structuredClone(parsedRun.data)),
      controller: new AbortController(),
      result,
      resolve,
      settled: false,
    };
    this.#active = session;
    this.#setSnapshot({ phase: "creating_draft", requestId });

    if (options.signal) {
      const onAbort = () => {
        void this.#abortSession(session, "aborted");
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      session.removeExternalAbort = () =>
        options.signal?.removeEventListener("abort", onAbort);
    }

    void this.#createDraft(session);
    return result;
  }

  approve(evidence: unknown): Promise<HumanDecisionReceipt> {
    return this.#humanDecision("approve", evidence);
  }

  reject(evidence: unknown): Promise<HumanDecisionReceipt> {
    return this.#humanDecision("reject", evidence);
  }

  /** Abort the current review and best-effort reject any server draft. */
  async abort(reason: ConfirmationAbortReason = "aborted"): Promise<boolean> {
    const session = this.#active;
    if (!session || session.settled) return false;
    await this.#abortSession(session, reason);
    return true;
  }

  /** Permanent navigation/unmount cleanup; the coordinator cannot be reused. */
  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const session = this.#active;
    if (session && !session.settled) {
      await this.#abortSession(session, "navigation");
    }
    this.#setSnapshot({ phase: "disposed" });
    this.#listeners.clear();
  }

  /** Allows a UI visibility/timer callback to reconcile expiry immediately. */
  async checkForStaleDraft(): Promise<boolean> {
    const session = this.#active;
    if (
      !session ||
      session.settled ||
      !session.expiresAtMs ||
      this.#now() < session.expiresAtMs
    ) {
      return false;
    }
    await this.#expireSession(session);
    return true;
  }

  async #createDraft(session: ActiveSession<THandle>): Promise<void> {
    let challenge: ConfirmationDraftChallenge<THandle> | undefined;
    try {
      challenge = await this.#transport.createDraft(structuredClone(session.draft), {
        signal: session.controller.signal,
      });
      const suite = SuiteDefinitionV2Schema.parse(challenge.suite);
      const expiresAtMs = Date.parse(challenge.expiresAt);
      if (
        !challenge.draftId ||
        challenge.draftId.length > 200 ||
        !Number.isFinite(expiresAtMs)
      ) {
        throw new ConfirmationTransportError("invalid_response");
      }

      if (!this.#isCurrent(session) || session.controller.signal.aborted) {
        await this.#cleanupDetached(challenge);
        return;
      }
      session.draftId = challenge.draftId;
      session.expiresAt = new Date(expiresAtMs).toISOString();
      session.expiresAtMs = expiresAtMs;
      session.suite = deepFreeze(suite);
      session.handle = challenge.handle;

      if (this.#now() >= expiresAtMs) {
        await this.#expireSession(session);
        return;
      }

      const review = this.#review(session);
      this.#setSnapshot({ phase: "pending_review", ...review });
      session.cancelExpiry = this.#schedule(() => {
        void this.#expireSession(session);
      }, Math.max(0, expiresAtMs - this.#now()));
    } catch (error) {
      if (!this.#isCurrent(session)) {
        if (challenge) await this.#cleanupDetached(challenge);
        return;
      }
      if (session.controller.signal.aborted) {
        await this.#abortSession(session, "aborted");
        if (challenge) await this.#cleanupDetached(challenge);
        return;
      }
      if (
        error instanceof ConfirmationTransportError &&
        (error.code === "stale_draft" || error.code === "draft_conflict")
      ) {
        this.#finish(session, staleResult());
      } else {
        this.#finish(session, transportFailure());
      }
      if (challenge) await this.#cleanupDetached(challenge);
    }
  }

  async #humanDecision(
    decision: ConfirmationDecision,
    evidence: unknown,
  ): Promise<HumanDecisionReceipt> {
    if (this.#disposed) return { accepted: false, reason: "disposed" };
    const session = this.#active;
    if (!session || session.settled) {
      return {
        accepted: false,
        reason:
          this.#snapshot.phase === "terminal"
            ? "decision_already_taken"
            : "no_pending_review",
      };
    }
    if (session.decision || this.#snapshot.phase !== "pending_review") {
      return { accepted: false, reason: "decision_already_taken" };
    }

    const review = this.#review(session);
    const evidenceIsObject =
      (typeof evidence === "object" && evidence !== null) ||
      typeof evidence === "function";
    let trusted = false;
    if (evidenceIsObject) {
      try {
        trusted = this.#verifyHumanDecision(evidence, decision, review);
      } catch {
        trusted = false;
      }
    }
    if (!trusted) return { accepted: false, reason: "untrusted_evidence" };

    if (session.expiresAtMs === undefined || this.#now() >= session.expiresAtMs) {
      await this.#expireSession(session);
      return { accepted: false, reason: "stale_draft" };
    }

    session.decision = decision;
    session.cancelExpiry?.();
    session.cancelExpiry = undefined;
    this.#setSnapshot({
      phase: decision === "approve" ? "approving" : "rejecting",
      ...review,
    });

    if (decision === "approve") await this.#approveSession(session);
    else await this.#rejectSession(session);
    return { accepted: true, requestId: session.requestId, decision };
  }

  async #approveSession(session: ActiveSession<THandle>): Promise<void> {
    if (!this.#isReady(session)) return;
    try {
      const rawReceipt = await this.#transport.approveAndRun({
        draftId: session.draftId,
        handle: session.handle,
        run: structuredClone(session.run),
        signal: session.controller.signal,
      });
      if (!this.#isCurrent(session)) return;
      const run = safeRunReceipt(rawReceipt);
      if (!run) throw new ConfirmationTransportError("invalid_response");
      this.#finish(
        session,
        deepFreeze({
          ok: true,
          status: "approved",
          message: "The human approved this exact suite and the comparison was started.",
          run,
        }),
      );
    } catch (error) {
      if (!this.#isCurrent(session)) return;
      if (
        error instanceof ConfirmationTransportError &&
        (error.code === "stale_draft" || error.code === "draft_conflict")
      ) {
        const cleanup = this.#privateDraft(session);
        this.#finish(session, staleResult());
        if (cleanup) await this.#cleanupDetached(cleanup);
      } else if (session.controller.signal.aborted) {
        this.#finish(session, transportFailure(true));
      } else {
        this.#finish(session, transportFailure(true));
      }
    }
  }

  async #rejectSession(session: ActiveSession<THandle>): Promise<void> {
    if (!this.#isReady(session)) return;
    try {
      await this.#transport.rejectDraft({
        draftId: session.draftId,
        handle: session.handle,
        signal: session.controller.signal,
      });
      if (!this.#isCurrent(session)) return;
      this.#finish(
        session,
        deepFreeze({
          ok: false,
          status: "rejected",
          code: "human_rejected",
          message: "The human rejected this draft. Nothing was published or run.",
        }),
      );
    } catch (error) {
      if (!this.#isCurrent(session)) return;
      if (
        error instanceof ConfirmationTransportError &&
        (error.code === "stale_draft" || error.code === "draft_conflict")
      ) {
        this.#finish(session, staleResult());
      } else {
        this.#finish(session, transportFailure());
      }
    }
  }

  async #expireSession(session: ActiveSession<THandle>): Promise<void> {
    if (!this.#isCurrent(session) || session.decision) return;
    session.decision = "aborted";
    const cleanup = this.#privateDraft(session);
    session.controller.abort();
    this.#finish(session, staleResult());
    if (cleanup) await this.#cleanupDetached(cleanup);
  }

  async #abortSession(
    session: ActiveSession<THandle>,
    reason: ConfirmationAbortReason,
  ): Promise<void> {
    if (!this.#isCurrent(session)) return;
    const approvalInFlight = session.decision === "approve";
    session.decision = reason;
    const cleanup = this.#privateDraft(session);
    session.controller.abort();
    this.#finish(
      session,
      approvalInFlight ? transportFailure(true) : abortedResult(reason),
    );
    if (cleanup && !approvalInFlight) await this.#cleanupDetached(cleanup);
  }

  #review(session: ActiveSession<THandle>): ConfirmationReviewSnapshot {
    if (!session.draftId || !session.expiresAt || !session.suite) {
      throw new ConfirmationTransportError("invalid_response");
    }
    return deepFreeze({
      requestId: session.requestId,
      draftId: session.draftId,
      expiresAt: session.expiresAt,
      suite: session.suite,
    });
  }

  #privateDraft(
    session: ActiveSession<THandle>,
  ): ConfirmationDraftChallenge<THandle> | undefined {
    if (
      !session.draftId ||
      !session.expiresAt ||
      !session.suite ||
      session.handle === undefined
    ) {
      return undefined;
    }
    return {
      draftId: session.draftId,
      expiresAt: session.expiresAt,
      suite: session.suite,
      handle: session.handle,
    };
  }

  async #cleanupDetached(challenge: ConfirmationDraftChallenge<THandle>): Promise<void> {
    const controller = new AbortController();
    try {
      await this.#transport.rejectDraft({
        draftId: challenge.draftId,
        handle: challenge.handle,
        signal: controller.signal,
      });
    } catch {
      // Cleanup is best effort. No transport error or opaque handle is exposed.
    } finally {
      controller.abort();
    }
  }

  #isCurrent(session: ActiveSession<THandle>): boolean {
    return this.#active === session && !session.settled;
  }

  #isReady(
    session: ActiveSession<THandle>,
  ): session is ActiveSession<THandle> & {
    draftId: string;
    handle: THandle;
  } {
    return (
      this.#isCurrent(session) &&
      Boolean(session.draftId) &&
      session.handle !== undefined
    );
  }

  #finish(
    session: ActiveSession<THandle>,
    result: ConfirmationTerminalResult,
  ): void {
    if (session.settled) return;
    session.settled = true;
    session.cancelExpiry?.();
    session.removeExternalAbort?.();
    session.cancelExpiry = undefined;
    session.removeExternalAbort = undefined;
    session.handle = undefined;
    session.suite = undefined;
    session.draft = {} as GuidedSuiteDraft;
    session.run = {};
    if (this.#active === session) this.#active = undefined;
    const safeResult = deepFreeze(result);
    if (!this.#disposed) {
      this.#setSnapshot({ phase: "terminal", requestId: session.requestId, result: safeResult });
    }
    session.resolve(safeResult);
  }

  #setSnapshot(snapshot: ConfirmationCoordinatorSnapshot): void {
    this.#snapshot = deepFreeze(snapshot);
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch {
        // A rendering subscriber cannot interrupt a security state transition.
      }
    }
  }
}
