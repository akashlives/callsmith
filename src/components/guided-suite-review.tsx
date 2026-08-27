"use client";

import {
  ArrowRight,
  Check,
  CircleAlert,
  LoaderCircle,
  LockKeyhole,
  ShieldAlert,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type {
  GuidedSuiteDraft,
  JsonValue,
  SuiteDefinitionV2,
  ToolDefinition,
} from "@/lib/contracts";

export type GuidedSuiteReviewStatus =
  | "pending"
  | "approving"
  | "rejecting"
  | "approved"
  | "rejected"
  | "error";

export interface GuidedSuiteReviewProps {
  draft: GuidedSuiteDraft;
  compiledSuite: SuiteDefinitionV2;
  onApprove: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
  onDismiss?: () => void;
  status?: GuidedSuiteReviewStatus;
  errorMessage?: string;
}

type Decision = "approve" | "reject";

const assertionCategoryLabels = {
  taskOutcome: "Task outcome",
  trajectory: "Trajectory",
  safety: "Safety",
  recovery: "Recovery",
} as const;

function displayJson(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function toolByName(tools: ToolDefinition[], name: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.name === name);
}

function ToolList({ tools, kind }: { tools: ToolDefinition[]; kind: "read" | "mutation" }) {
  return (
    <section className={`suite-review__tool-group is-${kind}`}>
      <div className="suite-review__section-heading">
        <span aria-hidden="true">{kind === "read" ? "R" : "M"}</span>
        <div>
          <p>{kind === "read" ? "Read tools" : "Mutation tools"}</p>
          <small>{tools.length} declared</small>
        </div>
      </div>
      <ul className="suite-review__tool-list">
        {tools.map((tool) => (
          <li key={tool.name}>
            <div>
              <strong>{tool.title}</strong>
              <code>{tool.name}</code>
            </div>
            <p>{tool.description}</p>
            <span>
              {tool.action.kind} · {tool.action.collection}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function statusCopy(
  status: GuidedSuiteReviewStatus,
  errorMessage?: string,
): { heading: string; detail: string } {
  switch (status) {
    case "approving":
      return {
        heading: "Recording approval…",
        detail: "Keep this review open while the explicit human decision is recorded.",
      };
    case "rejecting":
      return {
        heading: "Recording rejection…",
        detail: "No publication or run can begin while this decision is being recorded.",
      };
    case "approved":
      return {
        heading: "Suite approved.",
        detail: "The explicit review is complete. The approved suite may now continue.",
      };
    case "rejected":
      return {
        heading: "Suite rejected.",
        detail: "The draft will not be published or run from this review.",
      };
    case "error":
      return {
        heading: "The decision was not recorded.",
        detail: errorMessage ?? "Try the decision again or dismiss this review safely.",
      };
    case "pending":
      return {
        heading: "Waiting for your decision.",
        detail: "Nothing publishes or runs until a person chooses Approve.",
      };
  }
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The decision could not be recorded. Try again.";
}

export function GuidedSuiteReview({
  draft,
  compiledSuite,
  onApprove,
  onReject,
  onDismiss,
  status = "pending",
  errorMessage,
}: GuidedSuiteReviewProps) {
  const instanceId = useId();
  const titleId = `${instanceId}-title`;
  const descriptionId = `${instanceId}-description`;
  const dialogRef = useRef<HTMLElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [localDecision, setLocalDecision] = useState<Decision | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const effectiveStatus: GuidedSuiteReviewStatus = localDecision
    ? localDecision === "approve"
      ? "approving"
      : "rejecting"
    : localError
      ? "error"
      : status;
  const effectiveError = localError ?? errorMessage;
  const isProcessing =
    effectiveStatus === "approving" || effectiveStatus === "rejecting";
  const isComplete =
    effectiveStatus === "approved" || effectiveStatus === "rejected";
  const controlsDisabled = isProcessing || isComplete;
  const readTools = draft.tools.filter((tool) => tool.annotations.readOnlyHint);
  const mutationTools = draft.tools.filter(
    (tool) => !tool.annotations.readOnlyHint,
  );
  const hostileContent = draft.faults.maliciousContent;
  const assertions = compiledSuite.scenarios[0]?.assertions ?? [];
  const currentStatusCopy = statusCopy(effectiveStatus, effectiveError);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    rejectRef.current?.focus();

    return () => previousFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    if (effectiveStatus !== "pending") statusRef.current?.focus();
  }, [effectiveStatus]);

  async function takeDecision(decision: Decision) {
    if (controlsDisabled || localDecision) return;
    setLocalError(null);
    setLocalDecision(decision);
    try {
      await (decision === "approve" ? onApprove() : onReject());
    } catch (error) {
      setLocalError(errorText(error));
    } finally {
      setLocalDecision(null);
    }
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      if (!controlsDisabled && onDismiss) {
        event.preventDefault();
        onDismiss();
      }
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [rejectRef.current, approveRef.current].filter(
      (element): element is HTMLButtonElement => Boolean(element && !element.disabled),
    );
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="suite-review-backdrop" role="presentation">
      <article
        ref={dialogRef}
        className="suite-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isProcessing}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="suite-review__header">
          <div>
            <p className="suite-review__eyebrow">
              Exact review · Human decision required
            </p>
            <h2 id={titleId}>Review {draft.title}</h2>
            <p id={descriptionId}>
              Inspect the exact synthetic suite contract before anything can be
              published or run. An agent cannot activate either decision.
            </p>
          </div>
          <dl className="suite-review__identity">
            <div>
              <dt>Suite</dt>
              <dd>
                <code>{draft.id}</code> <span>v{draft.version}</span>
              </dd>
            </div>
            <div>
              <dt>Domain</dt>
              <dd>{draft.domain}</dd>
            </div>
          </dl>
        </header>

        <div className="suite-review__body">
          <section className="suite-review__goal" aria-labelledby={`${instanceId}-goal`}>
            <p className="suite-review__label" id={`${instanceId}-goal`}>
              Agent goal
            </p>
            <p>{draft.goal}</p>
          </section>

          <div className="suite-review__tool-grid" aria-label="Declared browser tools">
            <ToolList tools={readTools} kind="read" />
            <ToolList tools={mutationTools} kind="mutation" />
          </div>

          <div className="suite-review__risk-grid">
            <section className="suite-review__hostile" aria-labelledby={`${instanceId}-hostile`}>
              <div className="suite-review__section-heading">
                <ShieldAlert size={17} aria-hidden="true" />
                <div>
                  <p id={`${instanceId}-hostile`}>Hostile content fixture</p>
                  <small>
                    {hostileContent
                      ? `Returned by ${hostileContent.toolName}`
                      : "No malicious-content fault declared"}
                  </small>
                </div>
              </div>
              <blockquote>
                {hostileContent
                  ? displayJson(hostileContent.payload)
                  : "No hostile content fixture was declared."}
              </blockquote>
            </section>

            <section className="suite-review__boundary" aria-labelledby={`${instanceId}-boundary`}>
              <div className="suite-review__section-heading">
                <LockKeyhole size={17} aria-hidden="true" />
                <div>
                  <p id={`${instanceId}-boundary`}>Protected state boundary</p>
                  <small><code>{draft.contractDesign.protectedState.path}</code></small>
                </div>
              </div>
              <div className="suite-review__state-transition">
                <div className="is-safe">
                  <span>Must remain</span>
                  <code>{displayJson(draft.contractDesign.protectedState.safeValue)}</code>
                </div>
                <ArrowRight size={18} aria-label="changes unsafely to" />
                <div className="is-risk">
                  <span>Unsafe state</span>
                  <code>{displayJson(draft.contractDesign.protectedState.unsafeValue)}</code>
                </div>
              </div>
            </section>
          </div>

          <div className="suite-review__requirements-grid">
            <section aria-labelledby={`${instanceId}-confirmation`}>
              <p className="suite-review__label" id={`${instanceId}-confirmation`}>
                Confirmation required
              </p>
              <ul>
                {draft.contractDesign.confirmationTools.map((name) => {
                  const tool = toolByName(draft.tools, name);
                  return (
                    <li key={name}>
                      <LockKeyhole size={14} aria-hidden="true" />
                      <span>
                        <strong>{tool?.title ?? name}</strong>
                        <code>{name}</code>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section aria-labelledby={`${instanceId}-idempotency`}>
              <p className="suite-review__label" id={`${instanceId}-idempotency`}>
                Idempotency required
              </p>
              <ul>
                {draft.contractDesign.idempotencyTools.map((requirement) => {
                  const tool = toolByName(draft.tools, requirement.toolName);
                  return (
                    <li key={`${requirement.toolName}-${requirement.argument}`}>
                      <Check size={14} aria-hidden="true" />
                      <span>
                        <strong>{tool?.title ?? requirement.toolName}</strong>
                        <code>{requirement.toolName} · {requirement.argument}</code>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          <section className="suite-review__assertions" aria-labelledby={`${instanceId}-assertions`}>
            <div className="suite-review__section-heading">
              <span aria-hidden="true">{assertions.length}</span>
              <div>
                <p id={`${instanceId}-assertions`}>Derived assertions</p>
                <small>Generated by the bounded compiler</small>
              </div>
            </div>
            <ol>
              {assertions.map((assertion) => (
                <li key={assertion.id}>
                  <span>{assertionCategoryLabels[assertion.category]}</span>
                  <strong>{assertion.description}</strong>
                  <code>{assertion.kind}</code>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <footer className="suite-review__footer">
          <div
            ref={statusRef}
            className={`suite-review__status is-${effectiveStatus}`}
            role={effectiveStatus === "error" ? "alert" : "status"}
            aria-live={effectiveStatus === "error" ? "assertive" : "polite"}
            tabIndex={-1}
          >
            {isProcessing ? (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            ) : effectiveStatus === "error" ? (
              <CircleAlert size={18} aria-hidden="true" />
            ) : isComplete ? (
              <Check size={18} aria-hidden="true" />
            ) : (
              <LockKeyhole size={18} aria-hidden="true" />
            )}
            <span>
              <strong>{currentStatusCopy.heading}</strong>
              <small>{currentStatusCopy.detail}</small>
            </span>
          </div>
          <div className="suite-review__actions">
            <button
              ref={rejectRef}
              className="suite-review__reject"
              type="button"
              disabled={controlsDisabled}
              onClick={() => void takeDecision("reject")}
            >
              <X size={17} aria-hidden="true" />
              {effectiveStatus === "rejecting" ? "Rejecting…" : "Reject suite"}
            </button>
            <button
              ref={approveRef}
              className="suite-review__approve"
              type="button"
              disabled={controlsDisabled}
              onClick={() => void takeDecision("approve")}
            >
              <Check size={17} aria-hidden="true" />
              {effectiveStatus === "approving" ? "Approving…" : "Approve suite"}
            </button>
          </div>
        </footer>
      </article>
    </div>
  );
}

export default GuidedSuiteReview;
