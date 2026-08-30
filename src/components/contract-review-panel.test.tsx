// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAFETY_CONTRACT } from "@/lib/canonical-contract";

import {
  ContractReviewPanel,
  type ContractProposalResponse,
} from "./contract-review-panel";

const proposal: ContractProposalResponse = {
  operation: {
    operationId: "proposal-review",
    status: "awaiting_review",
    expiresAt: "2026-08-28T22:00:00.000Z",
  },
  review: {
    draft: CANONICAL_SAFETY_CONTRACT,
    protectedState: {
      path: "followups.0.status",
      safeValue: "draft",
      unsafeValue: "sent",
    },
    prompt: CANONICAL_SAFETY_CONTRACT.goal,
    expectedCalls: [
      { toolName: "read_meeting_note", args: { record_id: "followup-001" } },
      { toolName: "send_followup", args: { record_id: "followup-001" } },
    ],
  },
  privateCapabilities: { ownerToken: "owner-secret", decisionToken: "decision-secret" },
  statusCapability: "status-capability",
  links: {
    status: "/api/contracts/proposals/proposal-review/status",
    decision: "/api/contracts/proposals/proposal-review/decision",
  },
};

describe("safety contract human review", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the exact boundary and never enables declarative autosubmit", () => {
    render(
      <ContractReviewPanel proposal={proposal} onClose={vi.fn()} onDecided={vi.fn()} />,
    );

    const form = screen.getByRole("dialog").querySelector("form");
    expect(form).toHaveAttribute("toolname", "review_callsmith_contract");
    expect(form).not.toHaveAttribute("toolautosubmit");
    expect(screen.getByText(CANONICAL_SAFETY_CONTRACT.record.hostileContent)).toBeVisible();
    expect(screen.getByText("followups.0.status")).toBeVisible();
    expect(screen.getByText("send_followup")).toBeVisible();
  });

  it("records explicit approval with only the private decision capability", async () => {
    const decided = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({ experiment: { id: "experiment-approved", status: "queued" } }, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ContractReviewPanel proposal={proposal} onClose={vi.fn()} onDecided={decided} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve and run" }));

    await waitFor(() => expect(decided).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      proposal.links.decision,
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer decision-secret",
        },
        body: JSON.stringify({ decision: "approve" }),
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("The experiment was queued");
  });

  it("rejects without asking for or creating an experiment", async () => {
    const decided = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({ operation: { status: "rejected" }, experiment: null }),
      ),
    );
    render(
      <ContractReviewPanel proposal={proposal} onClose={vi.fn()} onDecided={decided} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(decided).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("No experiment was created");
  });

  it("resets the human decision state when a new proposal replaces a rejected one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({ operation: { status: "rejected" }, experiment: null }),
      ),
    );
    const { rerender } = render(
      <ContractReviewPanel
        key={proposal.operation.operationId}
        proposal={proposal}
        onClose={vi.fn()}
        onDecided={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("No experiment was created");
    });

    const replacement: ContractProposalResponse = {
      ...proposal,
      operation: { ...proposal.operation, operationId: "proposal-replacement" },
      links: {
        status: "/api/contracts/proposals/proposal-replacement/status",
        decision: "/api/contracts/proposals/proposal-replacement/decision",
      },
    };
    rerender(
      <ContractReviewPanel
        key={replacement.operation.operationId}
        proposal={replacement}
        onClose={vi.fn()}
        onDecided={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Waiting for your explicit decision");
    expect(screen.getByRole("button", { name: "Approve and run" })).toBeEnabled();
  });
});
