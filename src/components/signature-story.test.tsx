// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TICKETING_SAFETY_SUITE } from "@/lib/canonical-contract";
import { completedAttemptFixture } from "@/lib/__tests__/experiment-fixtures";
import { buildEvidenceReceiptFromExperiment } from "@/lib/evidence-receipt-server";
import { ExperimentRecordV1Schema } from "@/lib/experiments";

import { SignatureStory } from "./signature-story";

function receiptFixture() {
  const scenario = TICKETING_SAFETY_SUITE.scenarios[0];
  const experiment = ExperimentRecordV1Schema.parse({
    schemaVersion: 1,
    id: "experiment-component-test",
    contractId: TICKETING_SAFETY_SUITE.id,
    contractVersion: TICKETING_SAFETY_SUITE.version,
    model: "gpt-5.6-luna",
    seed: scenario.seed,
    status: "completed",
    evidenceStatus: "conclusive",
    attempts: [completedAttemptFixture("weak"), completedAttemptFixture("hardened")],
    createdAt: "2026-08-28T20:00:00.000Z",
    updatedAt: "2026-08-28T20:01:00.000Z",
  });
  return buildEvidenceReceiptFromExperiment({
    experiment,
    suite: TICKETING_SAFETY_SUITE,
    framework: {
      nodeVersion: "24.20.0",
      applicationRevision: "test-revision",
      frameworkManifestRevision: "test-manifest",
    },
  });
}

const created = {
  experiment: {
    schemaVersion: 1,
    id: "experiment-component-test",
    status: "queued",
    evidenceStatus: "pending",
    model: "gpt-5.6-luna",
    seed: 701,
    attempts: [],
    receiptAvailable: false,
    updatedAt: "2026-08-28T20:00:00.000Z",
  },
  accessToken: "access-token",
  receiptToken: "receipt-token",
  links: {
    status: "/api/experiments/experiment-component-test",
    events: "/api/experiments/experiment-component-test/events",
    receipt: "/r/receipt-token",
  },
};

describe("charge photograph story", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts a ticketing pair and does not invent CHARGED at rest", async () => {
    const receipt = receiptFixture();
    const terminalEvent = {
      ...created.experiment,
      status: "completed",
      evidenceStatus: "conclusive",
      receiptAvailable: true,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/experiments") {
        expect(init).toMatchObject({
          method: "POST",
          body: JSON.stringify({ suiteId: "ticketing-seats-boundary" }),
        });
        return new Response(JSON.stringify(created), { status: 202 });
      }
      if (url.endsWith("/events")) {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer access-token",
        );
        return new Response(
          `event: experiment\ndata: ${JSON.stringify(terminalEvent)}\n\n`,
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      if (url === "/api/receipts/receipt-token") {
        return new Response(JSON.stringify(receipt), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SignatureStory />);
    expect(
      screen.getByRole("heading", {
        name: /\$186 held for you until a sealed pair exists/i,
      }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Open the live hold" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/WebMCP|Luna|MSTI|ACP/)).not.toBeInTheDocument();
    expect(screen.queryByText("CHARGED · by the site")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Prove it again" }));

    expect(
      await screen.findByRole("heading", {
        name: /Same hold. One website charged. The other held it for you/i,
      }),
    ).toBeVisible();
    expect(screen.getAllByText("CHARGED · by the site").length).toBeGreaterThan(0);
    expect(screen.getAllByText("HELD · awaiting you").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Download JSON receipt/ })).toHaveAttribute(
      "href",
      "/api/receipts/receipt-token",
    );
  });

  it("fails honestly when the runner cannot start", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Browser worker unavailable" }), {
          status: 503,
        }),
      ),
    );
    render(<SignatureStory />);
    fireEvent.click(screen.getByRole("button", { name: "Prove it again" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Browser worker unavailable",
    );
    expect(screen.getByRole("button", { name: /Retry the pair/ })).toBeVisible();
    expect(screen.queryByText("CHARGED · by the site")).not.toBeInTheDocument();
  });

  it("does not turn an incomplete pair into a charged claim", async () => {
    const terminalEvent = {
      ...created.experiment,
      status: "partial_failure",
      evidenceStatus: "inconclusive",
      receiptAvailable: false,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/experiments") {
        return new Response(JSON.stringify(created), { status: 202 });
      }
      if (url.endsWith("/events")) {
        return new Response(
          `event: experiment\ndata: ${JSON.stringify(terminalEvent)}\n\n`,
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(terminalEvent), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SignatureStory />);
    fireEvent.click(screen.getByRole("button", { name: "Prove it again" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/inconclusive/i);
    expect(screen.queryByText("CHARGED · by the site")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it("shows a sealed ticketing pair before Prove it again and clears CHARGED when a live pair starts", async () => {
    const receipt = receiptFixture();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/experiments") {
        return new Response(JSON.stringify(created), { status: 202 });
      }
      if (url.endsWith("/events")) {
        return new Response(new ReadableStream({ start() {} }), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SignatureStory sealed={{ receipt, token: "public-token" }} />);
    expect(screen.getByRole("heading", { name: /\$186 charged on one website/i })).toBeVisible();
    expect(screen.getByText("CHARGED · by the site")).toBeVisible();
    expect(screen.getByText(receipt.contentHash)).toBeVisible();
    expect(screen.getByRole("link", { name: /Open report/ })).toHaveAttribute(
      "href",
      "/r/public-token",
    );

    fireEvent.click(screen.getByRole("button", { name: "Prove it again" }));

    expect(
      await screen.findByText("Same agent is trying to charge that hold on both websites"),
    ).toBeVisible();
    expect(screen.queryByText("CHARGED · by the site")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /\$186 held for you until a sealed pair exists/i })).toBeVisible();
  });

  it("stays at-rest when the sealed receipt is not a ticketing win", () => {
    const receipt = receiptFixture();
    render(
      <SignatureStory
        sealed={{
          receipt: { ...receipt, conclusion: "inconclusive" },
          token: "public-token",
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: /\$186 held for you until a sealed pair exists/i })).toBeVisible();
    expect(screen.queryByText("CHARGED · by the site")).not.toBeInTheDocument();
  });
});
