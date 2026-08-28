"use client";

import { Check, LockKeyhole, ShieldAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { SafetyContractDraftV1 } from "@/lib/safety-contract";

export type ContractProposalResponse = {
  operation: {
    operationId: string;
    status: "awaiting_review" | "approved" | "rejected" | "expired";
    expiresAt: string;
  };
  review: {
    draft: SafetyContractDraftV1;
    protectedState: { path: string; safeValue: unknown; unsafeValue: unknown };
    prompt: string;
    expectedCalls: Array<{ toolName?: string; args?: unknown }>;
  };
  privateCapabilities: { ownerToken: string; decisionToken: string };
  statusCapability: string;
  links: { status: string; decision: string };
};

export function ContractReviewPanel({
  proposal,
  onClose,
  onDecided,
}: {
  proposal: ContractProposalResponse;
  onClose: () => void;
  onDecided: (result: unknown) => void;
}) {
  const [status, setStatus] = useState<"pending" | "working" | "approved" | "rejected" | "error">("pending");
  const [error, setError] = useState<string>();
  const formRef = useRef<HTMLFormElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const draft = proposal.review.draft;

  useEffect(() => {
    const form = formRef.current;
    if (form) {
      form.setAttribute("toolname", "review_callsmith_contract");
      form.setAttribute(
        "tooldescription",
        "Review a proposed Callsmith safety contract. A human must choose; agents cannot submit this form.",
      );
      form.removeAttribute("toolautosubmit");
    }
    rejectRef.current?.focus();
  }, []);

  async function decide(decision: "approve" | "reject") {
    if (status !== "pending" && status !== "error") return;
    setStatus("working");
    setError(undefined);
    try {
      const response = await fetch(proposal.links.decision, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${proposal.privateCapabilities.decisionToken}`,
        },
        body: JSON.stringify({ decision }),
        cache: "no-store",
      });
      const result = (await response.json()) as { error?: unknown };
      if (!response.ok) throw new Error(String(result.error || "Decision failed"));
      setStatus(decision === "approve" ? "approved" : "rejected");
      onDecided(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The decision could not be recorded");
      setStatus("error");
    }
  }

  return (
    <div className="suite-review-backdrop" role="presentation">
      <article className="suite-review safety-contract-review" role="dialog" aria-modal="true" aria-labelledby="contract-review-title">
        <header className="suite-review__header">
          <div>
            <p className="suite-review__eyebrow">Exact review · Human decision required</p>
            <h2 id="contract-review-title">Review {draft.title}</h2>
            <p>An agent proposed this synthetic boundary. Nothing publishes or runs until you approve it here.</p>
          </div>
          <button className="suite-review__close" type="button" onClick={onClose} aria-label="Close review" disabled={status === "working"}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="suite-review__body">
          <section className="suite-review__goal">
            <p className="suite-review__label">Generated agent task</p>
            <p>{proposal.review.prompt}</p>
          </section>

          <div className="contract-review-grid">
            <section>
              <p className="suite-review__label">Untrusted content</p>
              <blockquote>{draft.record.hostileContent}</blockquote>
            </section>
            <section>
              <p className="suite-review__label">Protected transition</p>
              <code>{proposal.review.protectedState.path}</code>
              <p>{JSON.stringify(proposal.review.protectedState.safeValue)} → {JSON.stringify(proposal.review.protectedState.unsafeValue)}</p>
            </section>
          </div>

          <section className="contract-review-tools">
            <p className="suite-review__label">Browser tools</p>
            <div>
              <span><strong>Read</strong><code>{draft.tools.read.name}</code></span>
              <span><strong>Protected mutation</strong><code>{draft.tools.protectedMutation.name}</code></span>
            </div>
          </section>

          <section className="suite-review__boundary">
            <ShieldAlert size={18} aria-hidden="true" />
            <div>
              <strong>What approval means</strong>
              <p>Publish this immutable synthetic contract and run one browser-native weak/hardened experiment. It cannot contact an external system.</p>
            </div>
          </section>
        </div>

        <form
          ref={formRef}
          className="suite-review__actions"
          onSubmit={(event) => event.preventDefault()}
        >
          <div role="status" aria-live="polite">
            <LockKeyhole size={15} aria-hidden="true" />
            <span>
              {status === "working"
                ? "Recording your decision…"
                : status === "approved"
                  ? "Approved. The experiment was queued."
                  : status === "rejected"
                    ? "Rejected. No experiment was created."
                    : error || "Waiting for your explicit decision."}
            </span>
          </div>
          <div>
            <button ref={rejectRef} type="button" disabled={status === "working" || status === "approved" || status === "rejected"} onClick={() => void decide("reject")}>
              <X size={15} aria-hidden="true" /> Reject
            </button>
            <button className="is-primary" type="button" disabled={status === "working" || status === "approved" || status === "rejected"} onClick={() => void decide("approve")}>
              <Check size={15} aria-hidden="true" /> Approve and run
            </button>
          </div>
        </form>
      </article>
    </div>
  );
}

