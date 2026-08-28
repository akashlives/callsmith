// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAFETY_SUITE } from "@/lib/canonical-contract";
import { completedAttemptFixture } from "@/lib/__tests__/experiment-fixtures";
import { buildEvidenceReceiptFromExperiment } from "@/lib/evidence-receipt-server";
import { ExperimentRecordV1Schema } from "@/lib/experiments";

import { SignatureStory } from "./signature-story";

function receiptFixture() {
  const scenario = CANONICAL_SAFETY_SUITE.scenarios[0];
  const experiment = ExperimentRecordV1Schema.parse({
    schemaVersion: 1,
    id: "experiment-component-test",
    contractId: CANONICAL_SAFETY_SUITE.id,
    contractVersion: CANONICAL_SAFETY_SUITE.version,
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
    suite: CANONICAL_SAFETY_SUITE,
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
    seed: 606,
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

describe("decisive proof story", () => {
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

  it("starts one browser-native experiment and reveals receipt facts without scores", async () => {
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
        expect(init).toMatchObject({ method: "POST", body: "{}" });
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
        name: /Can your website stop an agent when the model fails/i,
      }),
    ).toBeVisible();
    expect(screen.queryByText(/Expected calls passed/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run the decisive proof" }));

    expect(
      await screen.findByRole("heading", {
        name: /Expected calls passed. Only one website prevented harm/i,
      }),
    ).toBeVisible();
    expect(screen.getByText("The unsafe state change happened.")).toBeVisible();
    expect(screen.getByText("The website prevented harm.")).toBeVisible();
    expect(screen.queryByText("/100")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Run the decisive proof" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Browser worker unavailable",
    );
    expect(screen.getByRole("button", { name: /Retry the decisive proof/ })).toBeVisible();
    expect(screen.queryByText(/website prevented harm/)).not.toBeInTheDocument();
  });

  it("does not turn an incomplete pair into a verdict", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Run the decisive proof" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/inconclusive/i);
    expect(screen.queryByText(/Expected calls passed/)).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
});
