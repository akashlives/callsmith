import { describe, expect, it } from "vitest";

import { RunResultSchema } from "@/lib/contracts";
import {
  createPreviewAttempt,
  createProviderFailureAttempt,
} from "@/lib/evaluation";
import { getScenario, SALES_GAUNTLET_SUITE } from "@/lib/suites";

import { buildCaseComparisonViewModel } from "./case-comparison";

const scenario = getScenario("sales-follow-through", "injection-confirmation")!;

function comparisonRun() {
  return RunResultSchema.parse({
    id: "run-story-test",
    suiteId: SALES_GAUNTLET_SUITE.id,
    suiteVersion: SALES_GAUNTLET_SUITE.version,
    scenarioId: scenario.id,
    models: ["gpt-5.6-luna"],
    repetitions: 1,
    seed: scenario.seed,
    provenance: "deterministic_preview",
    contractVariants: ["weak", "hardened"],
    status: "completed",
    attempts: [
      createPreviewAttempt(
        SALES_GAUNTLET_SUITE,
        scenario,
        "failure",
        "gpt-5.6-luna",
        scenario.seed,
        "weak",
      ),
      createPreviewAttempt(
        SALES_GAUNTLET_SUITE,
        scenario,
        "success",
        "gpt-5.6-luna",
        scenario.seed,
        "hardened",
      ),
    ],
    createdAt: "2026-08-26T12:00:00.000Z",
    updatedAt: "2026-08-26T12:00:01.000Z",
  });
}

describe("case comparison view model", () => {
  it("turns the signature RunResult into a verdict-first safety story", () => {
    const view = buildCaseComparisonViewModel(comparisonRun());

    expect(view.headline).toBe("Same agent. One website let it cross the line.");
    expect(view.provenanceLabel).toBe("Deterministic preview evidence");
    expect(view.evidenceModeLabel).toBe(
      "Deterministic preview · not a live replication",
    );
    expect(view.evidenceStatus).toBe("conclusive");
    expect(view.verdictAllowed).toBe(true);
    expect(view.passed).toBe(1);
    expect(view.attempts).toHaveLength(2);
    expect(view.attempts[0]).toMatchObject({
      modelLabel: "Luna",
      outcome: "Sent without approval",
      tone: "risk",
    });
    expect(view.attempts[1]).toMatchObject({
      modelLabel: "Luna",
      outcome: "Human boundary respected",
      tone: "safe",
    });
    expect(view.attempts[0].evidence.map((event) => event.title)).toContain(
      "The agent crossed the line",
    );
    expect(view.attempts[0].stateFacts).toContainEqual({
      label: "Customer reply",
      value: "sent",
      tone: "risk",
    });
  });

  it("preserves partial provider failures instead of inventing a result", () => {
    const run = comparisonRun();
    const failed = createProviderFailureAttempt(
      SALES_GAUNTLET_SUITE,
      scenario,
      "gpt-5.6-luna",
      scenario.seed,
      "Provider timed out",
    );
    const view = buildCaseComparisonViewModel(
      RunResultSchema.parse({
        ...run,
        status: "partial_failure",
        attempts: [failed, run.attempts[1]],
      }),
    );

    expect(view.headline).toBe("This comparison is inconclusive.");
    expect(view.resultKicker).toBe("Evidence status");
    expect(view.verdictAllowed).toBe(false);
    expect(view.attempts[0]).toMatchObject({
      outcome: "Provider attempt unavailable",
      summary: "Provider timed out",
      tone: "neutral",
    });
  });

  it("handles a terminal run with no captured attempts", () => {
    const view = buildCaseComparisonViewModel(
      RunResultSchema.parse({ ...comparisonRun(), status: "failed", attempts: [] }),
    );
    expect(view.total).toBe(0);
    expect(view.evidenceStatus).toBe("inconclusive");
    expect(view.headline).toBe("This comparison is inconclusive.");
  });

  it("withholds a verdict while matched evidence is pending", () => {
    const run = comparisonRun();
    const view = buildCaseComparisonViewModel(
      RunResultSchema.parse({
        ...run,
        status: "running",
        attempts: [run.attempts[0]],
      }),
    );

    expect(view.evidenceStatus).toBe("pending");
    expect(view.verdictAllowed).toBe(false);
    expect(view.headline).toBe("Evidence is still being collected.");
    expect(view.summary).toContain("No safety verdict yet");
    expect(view.attempts).toHaveLength(1);
  });

  it("states a provider failure without inferring a winner", () => {
    const run = comparisonRun();
    const failed = createProviderFailureAttempt(
      SALES_GAUNTLET_SUITE,
      scenario,
      "gpt-5.6-luna",
      scenario.seed,
      "Provider timed out",
      0,
      { contractVariant: "weak" },
    );
    const view = buildCaseComparisonViewModel(
      RunResultSchema.parse({
        ...run,
        status: "failed",
        attempts: [failed],
      }),
    );

    expect(view.evidenceStatus).toBe("provider_failure");
    expect(view.verdictAllowed).toBe(false);
    expect(view.headline).toBe("The provider did not complete the comparison.");
    expect(view.attempts[0].summary).toBe("Provider timed out");
  });

  it("labels live replication separately from preview evidence", () => {
    const run = comparisonRun();
    const view = buildCaseComparisonViewModel(
      RunResultSchema.parse({ ...run, provenance: "browser_webmcp" }),
    );

    expect(view.evidenceModeLabel).toBe("Live browser replication");
    expect(view.provenanceLabel).toBe("Browser-native WebMCP evidence");
  });

  it("does not call a safely unexercised pair a reliability gap", () => {
    const run = comparisonRun();
    const safeAttempt = run.attempts[1];
    const attempts = (["weak", "hardened"] as const).map((contractVariant, index) => ({
      ...safeAttempt,
      id: `attempt-unexercised-${index}`,
      scenarioId: "safety-boundary",
      contractVariant,
      safetyOutcome: "safe" as const,
      unsafeAttempted: false,
      harmPrevented: false,
      score: {
        ...safeAttempt.score,
        passed: false,
        total: 70,
      },
    }));
    const view = buildCaseComparisonViewModel(
      RunResultSchema.parse({
        ...run,
        scenarioId: "safety-boundary",
        provenance: "browser_webmcp",
        attempts,
      }),
    );

    expect(view.headline).toBe("The unsafe boundary was not exercised.");
    expect(view.summary).toContain("agent never attempted the consequential action");
    expect(view.attempts.map((attempt) => attempt.outcome)).toEqual([
      "Boundary not exercised",
      "Boundary not exercised",
    ]);
    expect(view.attempts[0].summary).not.toContain("customer reply");
  });
});
