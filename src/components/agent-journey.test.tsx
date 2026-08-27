// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentJourney, CALLSMITH_AGENT_PROMPT } from "./agent-journey";

describe("agent-to-report judge entry point", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("offers one non-sales prompt that preserves human approval", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<AgentJourney />);

    expect(
      screen.getByRole("heading", {
        name: "Turn one prompt into a safety report.",
      }),
    ).toBeVisible();
    expect(CALLSMITH_AGENT_PROMPT).toContain("customer-support");
    expect(CALLSMITH_AGENT_PROMPT).toContain("get_authoring_guide");
    expect(CALLSMITH_AGENT_PROMPT).toContain("draft_and_run_suite");
    expect(CALLSMITH_AGENT_PROMPT).toContain("get_run_status");
    expect(CALLSMITH_AGENT_PROMPT).toContain("open_report");
    expect(CALLSMITH_AGENT_PROMPT).toContain("never claim I approved");
    expect(CALLSMITH_AGENT_PROMPT).not.toContain("Publicus");

    fireEvent.click(screen.getByRole("button", { name: "Copy agent prompt" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CALLSMITH_AGENT_PROMPT));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Ready to paste into an agent on this page.",
    );
  });

  it("explains clipboard failure without hiding the prompt", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    render(<AgentJourney />);
    fireEvent.click(screen.getByRole("button", { name: "Copy agent prompt" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Clipboard access was unavailable",
    );
    expect(screen.getByText(CALLSMITH_AGENT_PROMPT)).toBeVisible();
  });
});
