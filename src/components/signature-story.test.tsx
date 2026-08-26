// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunResultSchema } from "@/lib/contracts";
import { createPreviewAttempt } from "@/lib/evaluation";
import { getScenario, SALES_GAUNTLET_SUITE } from "@/lib/suites";

import { SignatureStory, type ScenarioOption } from "./signature-story";

const scenario = getScenario("sales-follow-through", "injection-confirmation")!;
const scenarios: ScenarioOption[] = [
  {
    id: scenario.id,
    title: "The meeting-note trap",
    description: scenario.description,
    seed: scenario.seed,
  },
];

function completedRun() {
  return RunResultSchema.parse({
    id: "run-component-test",
    suiteId: SALES_GAUNTLET_SUITE.id,
    suiteVersion: SALES_GAUNTLET_SUITE.version,
    scenarioId: scenario.id,
    models: ["gpt-5.6-luna", "gpt-5.6-terra"],
    repetitions: 1,
    seed: scenario.seed,
    provenance: "preview",
    status: "completed",
    attempts: [
      createPreviewAttempt(SALES_GAUNTLET_SUITE, scenario, "failure", "gpt-5.6-luna"),
      createPreviewAttempt(SALES_GAUNTLET_SUITE, scenario, "success", "gpt-5.6-terra"),
    ],
    createdAt: "2026-08-26T12:00:00.000Z",
    updatedAt: "2026-08-26T12:00:01.000Z",
  });
}

class MockEventSource {
  static latest: MockEventSource | undefined;
  readonly listeners = new Map<string, EventListener>();
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    MockEventSource.latest = this;
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener);
  }

  emitRun(run: unknown) {
    this.listeners.get("run")?.(
      new MessageEvent("run", { data: JSON.stringify(run) }),
    );
  }

  close() {}
}

describe("signature story", () => {
  beforeEach(() => {
    MockEventSource.latest = undefined;
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts with one plain-language action and reveals only API evidence", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...completedRun(),
            status: "queued",
            attempts: [],
            links: { events: "/api/runs/run-component-test/events" },
          }),
          { status: 202, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ path: "/r/read-only-token" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<SignatureStory scenarios={scenarios} />);
    expect(screen.getByRole("heading", { name: /Catch unsafe agent behavior/ })).toBeVisible();
    expect(screen.queryByText("Same task. One crossed the line.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run the safety test" }));
    expect(screen.getByRole("status")).toHaveTextContent("Preparing sandbox");

    await waitFor(() => expect(MockEventSource.latest).toBeDefined());
    expect(screen.getByRole("status")).toHaveTextContent("Testing the boundary");

    act(() => MockEventSource.latest?.emitRun(completedRun()));
    await waitFor(() =>
      expect(screen.getByText("Same task. One crossed the line.")).toBeVisible(),
    );
    expect(screen.getAllByRole("heading", { name: "Sent without approval" })[0]).toBeVisible();
    expect(
      screen.getAllByRole("heading", { name: "Stopped for human confirmation" })[0],
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"scenarioId":"injection-confirmation"'),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create report link" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Open read-only report/ })).toHaveAttribute(
        "href",
        "/r/read-only-token",
      ),
    );
  });

  it("explains a start failure and offers a real retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Runner offline" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    render(<SignatureStory scenarios={scenarios} />);
    fireEvent.click(screen.getByRole("button", { name: "Run the safety test" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Runner offline");
    expect(screen.getByRole("button", { name: /Retry the safety test/ })).toBeVisible();
    expect(screen.queryByText("Same task. One crossed the line.")).not.toBeInTheDocument();
  });
});
