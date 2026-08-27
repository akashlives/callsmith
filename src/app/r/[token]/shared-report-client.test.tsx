// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunResultSchema } from "@/lib/contracts";
import { createPreviewAttempt } from "@/lib/evaluation";
import { getScenario, SALES_GAUNTLET_SUITE } from "@/lib/suites";

import SharedReportClient from "./shared-report-client";

const scenario = getScenario("sales-follow-through", "injection-confirmation")!;

function reportRun(conclusive: boolean) {
  const weak = createPreviewAttempt(
    SALES_GAUNTLET_SUITE,
    scenario,
    "failure",
    "gpt-5.6-luna",
    scenario.seed,
    "weak",
  );
  const hardened = createPreviewAttempt(
    SALES_GAUNTLET_SUITE,
    scenario,
    "success",
    "gpt-5.6-luna",
    scenario.seed,
    "hardened",
  );

  return RunResultSchema.parse({
    id: "run-shared-report-test",
    suiteId: SALES_GAUNTLET_SUITE.id,
    suiteVersion: SALES_GAUNTLET_SUITE.version,
    scenarioId: scenario.id,
    models: ["gpt-5.6-luna"],
    repetitions: 1,
    seed: scenario.seed,
    provenance: "deterministic_preview",
    contractVariants: ["weak", "hardened"],
    status: "completed",
    attempts: conclusive ? [weak, hardened] : [hardened],
    createdAt: "2026-08-26T12:00:00.000Z",
    updatedAt: "2026-08-26T12:00:01.000Z",
  });
}

function tokenFor(runId: string): string {
  const encoded = btoa(runId).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${encoded}.abcdefghijklmnop`;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("shared report verdict gating", () => {
  it("keeps the canonical verdict for a conclusive completed report", async () => {
    const run = reportRun(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(run), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    render(<SharedReportClient token={tokenFor(run.id)} />);

    expect(
      await screen.findByRole("heading", {
        name: "Same agent. One website let it cross the line.",
      }),
    ).toBeVisible();
    expect(screen.getByText("Evidence: conclusive")).toBeVisible();
    expect(
      screen.getAllByRole("heading", { name: "Sent without approval" })[0],
    ).toBeVisible();
  });

  it("shows an honest inconclusive status while preserving attempt evidence", async () => {
    const run = reportRun(false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(run), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    render(<SharedReportClient token={tokenFor(run.id)} />);

    expect(
      await screen.findByRole("heading", { name: "This comparison is inconclusive." }),
    ).toBeVisible();
    expect(screen.getByText("Evidence: inconclusive")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Preserved attempt evidence" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Human boundary respected" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Inspect preserved attempt evidence")).toBeVisible();
  });
});
