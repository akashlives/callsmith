import { describe, expect, it } from "vitest";

import {
  SafeActionSchema,
  SuiteDefinitionSchema,
  parseSuiteDefinition,
} from "@/lib/contracts";
import {
  SALES_GAUNTLET_SUITE,
  SUPPORT_ESCALATION_SUITE,
  getScenario,
  getSuite,
  listSuites,
  validateSuite,
} from "@/lib/suites";

describe("suite contracts", () => {
  it("validates the versioned sales gauntlet and all six fixtures", () => {
    expect(SuiteDefinitionSchema.parse(SALES_GAUNTLET_SUITE)).toEqual(
      SALES_GAUNTLET_SUITE,
    );
    expect(SALES_GAUNTLET_SUITE.schemaVersion).toBe(1);
    expect(SALES_GAUNTLET_SUITE.scenarios.map((scenario) => scenario.id)).toEqual([
      "happy-path",
      "ambiguous-account",
      "stale-context",
      "transient-failure",
      "duplicate-mutation",
      "injection-confirmation",
    ]);

    for (const scenario of SALES_GAUNTLET_SUITE.scenarios) {
      expect(scenario.syntheticData).toBe(true);
      expect(scenario.enabledTools.length).toBeGreaterThanOrEqual(2);
      expect(scenario.walkthroughs.success.length).toBeGreaterThanOrEqual(2);
      expect(scenario.walkthroughs.failure.length).toBeGreaterThanOrEqual(1);
      expect(new Set(scenario.assertions.map((item) => item.category))).toEqual(
        new Set(["taskOutcome", "trajectory", "safety", "recovery"]),
      );
    }
  });

  it("represents a second suite without application code", () => {
    const second = structuredClone(SALES_GAUNTLET_SUITE);
    second.id = "support-follow-through";
    second.version = "2.0.0";
    second.title = "Support Follow-through";
    second.scenarios = [
      {
        ...second.scenarios[0],
        id: "support-happy-path",
        title: "Support happy path",
      },
    ];
    expect(parseSuiteDefinition(second).id).toBe("support-follow-through");
  });

  it("loads the published non-sales starter from safe JSON", () => {
    expect(SUPPORT_ESCALATION_SUITE).toMatchObject({
      schemaVersion: 1,
      id: "support-escalation",
      syntheticData: true,
    });
    expect(SUPPORT_ESCALATION_SUITE.tools.map((tool) => tool.action.kind)).toEqual([
      "get",
      "append",
      "transition",
    ]);
    expect(listSuites().map((suite) => suite.id)).toContain("support-escalation");
  });

  it("rejects executable actions and unknown fields with actionable paths", () => {
    const unsafe = structuredClone(SALES_GAUNTLET_SUITE) as unknown as Record<
      string,
      unknown
    >;
    const tools = unsafe.tools as Array<Record<string, unknown>>;
    tools[0].action = { kind: "javascript", source: "fetch('/secrets')" };

    const result = validateSuite(unsafe);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join("\n")).toMatch(/tools\.0\.action/);
    }
  });

  it("rejects DSL arguments that strict input validation does not require", () => {
    const invalid = structuredClone(SALES_GAUNTLET_SUITE);
    invalid.tools[0].inputSchema.required = [];
    const result = validateSuite(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join("\n")).toContain(
        'Action argument "query" must be required',
      );
    }
  });

  it("allows only the five safe action kinds", () => {
    const kinds = SALES_GAUNTLET_SUITE.tools.map((tool) => tool.action.kind);
    expect(new Set(kinds)).toEqual(
      new Set(["query", "get", "patch", "append", "transition"]),
    );
    expect(SafeActionSchema.safeParse({ kind: "eval", code: "1 + 1" }).success).toBe(
      false,
    );
  });

  it("returns defensive copies from the suite registry", () => {
    const listed = listSuites();
    listed[0].title = "Changed";
    expect(getSuite(SALES_GAUNTLET_SUITE.id)?.title).toBe(
      "Sales Follow-through Gauntlet",
    );
    expect(getScenario(SALES_GAUNTLET_SUITE.id, "happy-path")?.id).toBe(
      "happy-path",
    );
  });

  it("grounds the live signature goal in synthetic identifiers", () => {
    const signature = getScenario(
      SALES_GAUNTLET_SUITE.id,
      "injection-confirmation",
    );
    expect(signature?.goal).toContain("mtg-001");
    expect(signature?.goal).toContain("acc-northstar");
    expect(signature?.goal).toContain("opp-001");
  });
});
