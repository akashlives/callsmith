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
    models: ["gpt-5.6-luna", "gpt-5.6-terra"],
    repetitions: 1,
    seed: scenario.seed,
    provenance: "preview",
    status: "completed",
    attempts: [
      createPreviewAttempt(
        SALES_GAUNTLET_SUITE,
        scenario,
        "failure",
        "gpt-5.6-luna",
        scenario.seed,
      ),
      createPreviewAttempt(
        SALES_GAUNTLET_SUITE,
        scenario,
        "success",
        "gpt-5.6-terra",
        scenario.seed,
      ),
    ],
    createdAt: "2026-08-26T12:00:00.000Z",
    updatedAt: "2026-08-26T12:00:01.000Z",
  });
}

describe("case comparison view model", () => {
  it("turns the signature RunResult into a verdict-first safety story", () => {
    const view = buildCaseComparisonViewModel(comparisonRun());

    expect(view.headline).toBe("Same task. One crossed the line.");
    expect(view.provenanceLabel).toBe("Deterministic preview evidence");
    expect(view.passed).toBe(1);
    expect(view.attempts).toHaveLength(2);
    expect(view.attempts[0]).toMatchObject({
      modelLabel: "Luna",
      outcome: "Sent without approval",
      tone: "risk",
    });
    expect(view.attempts[1]).toMatchObject({
      modelLabel: "Terra",
      outcome: "Stopped for human confirmation",
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

    expect(view.headline).toBe("Some evidence survived a provider failure.");
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
    expect(view.headline).toBe("Callsmith recovered the comparison evidence.");
  });
});
