// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GuidedSuiteDraftSchema } from "@/lib/contracts";
import { compileGuidedSuiteDraft } from "@/lib/suite-compiler";
import supportFixture from "../../tests/fixtures/guided-suite/support.json";

import { GuidedSuiteReview, type GuidedSuiteReviewProps } from "./guided-suite-review";

const draft = GuidedSuiteDraftSchema.parse(supportFixture);
const compiledSuite = compileGuidedSuiteDraft(draft);

function renderReview(overrides: Partial<GuidedSuiteReviewProps> = {}) {
  const props: GuidedSuiteReviewProps = {
    draft,
    compiledSuite,
    onApprove: vi.fn(),
    onReject: vi.fn(),
    ...overrides,
  };
  return { ...render(<GuidedSuiteReview {...props} />), props };
}

afterEach(() => cleanup());

describe("guided suite exact review", () => {
  it("shows the complete human review contract before a decision", () => {
    const { props } = renderReview();

    expect(
      screen.getByRole("dialog", { name: `Review ${draft.title}` }),
    ).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText(draft.id)).toBeVisible();
    expect(screen.getByText(draft.domain)).toBeVisible();
    expect(screen.getByText(draft.goal)).toBeVisible();

    expect(screen.getByText("Read tools")).toBeVisible();
    expect(screen.getByText("get_ticket")).toBeVisible();
    expect(screen.getByText("Mutation tools")).toBeVisible();
    expect(screen.getByText("create_investigation")).toBeVisible();
    expect(screen.getAllByText("escalate_ticket").length).toBeGreaterThan(0);

    expect(
      screen.getByText(draft.faults.maliciousContent!.payload),
    ).toBeVisible();
    expect(
      screen.getByText(draft.contractDesign.protectedState.path),
    ).toBeVisible();
    expect(
      screen.getByText(draft.contractDesign.protectedState.safeValue as string),
    ).toBeVisible();
    expect(
      screen.getByText(draft.contractDesign.protectedState.unsafeValue as string),
    ).toBeVisible();
    expect(screen.getByText("Confirmation required")).toBeVisible();
    expect(screen.getByText("Idempotency required")).toBeVisible();
    expect(screen.getByText(/create_investigation · request_id/)).toBeVisible();

    for (const assertion of compiledSuite.scenarios[0].assertions) {
      expect(screen.getByText(assertion.description)).toBeVisible();
    }

    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing publishes or runs until a person chooses Approve.",
    );
    expect(props.onApprove).not.toHaveBeenCalled();
    expect(props.onReject).not.toHaveBeenCalled();
  });

  it("places initial focus on Reject and traps keyboard focus inside the dialog", () => {
    const onDismiss = vi.fn();
    const { props } = renderReview({ onDismiss });
    const dialog = screen.getByRole("dialog");
    const reject = screen.getByRole("button", { name: "Reject suite" });
    const approve = screen.getByRole("button", { name: "Approve suite" });

    expect(reject).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(approve).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(reject).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(props.onApprove).not.toHaveBeenCalled();
    expect(props.onReject).not.toHaveBeenCalled();
  });

  it("restores focus to the invoking control when the review unmounts", () => {
    const opener = document.createElement("button");
    opener.textContent = "Open exact review";
    document.body.append(opener);
    opener.focus();

    const { unmount } = renderReview();
    expect(screen.getByRole("button", { name: "Reject suite" })).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("invokes only the button chosen by the human", async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const { unmount } = render(
      <GuidedSuiteReview
        draft={draft}
        compiledSuite={compiledSuite}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve suite" }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledOnce());
    expect(onReject).not.toHaveBeenCalled();

    unmount();
    render(
      <GuidedSuiteReview
        draft={draft}
        compiledSuite={compiledSuite}
        onApprove={vi.fn()}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reject suite" }));
    await waitFor(() => expect(onReject).toHaveBeenCalledOnce());
  });

  it("locks both decisions and announces processing while approval is unresolved", async () => {
    let finishApproval: (() => void) | undefined;
    const onApprove = vi.fn(
      () => new Promise<void>((resolve) => {
        finishApproval = resolve;
      }),
    );
    renderReview({ onApprove });

    fireEvent.click(screen.getByRole("button", { name: "Approve suite" }));

    const processing = await screen.findByRole("status");
    expect(processing).toHaveTextContent("Recording approval");
    expect(processing).toHaveFocus();
    expect(screen.getByRole("button", { name: "Reject suite" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approving…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Approving…" }));
    expect(onApprove).toHaveBeenCalledOnce();

    finishApproval?.();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approve suite" })).toBeEnabled(),
    );
  });

  it("announces a callback failure and permits an explicit retry", async () => {
    const onReject = vi.fn().mockRejectedValueOnce(new Error("Approval service unavailable"));
    renderReview({ onReject });

    fireEvent.click(screen.getByRole("button", { name: "Reject suite" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The decision was not recorded");
    expect(alert).toHaveTextContent("Approval service unavailable");
    expect(alert).toHaveFocus();
    expect(screen.getByRole("button", { name: "Reject suite" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Approve suite" })).toBeEnabled();
  });

  it.each([
    ["approved", "Suite approved."],
    ["rejected", "Suite rejected."],
  ] as const)("renders a semantic terminal %s state", (status, message) => {
    renderReview({ status });

    expect(screen.getByRole("status")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Reject suite" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve suite" })).toBeDisabled();
  });
});
