import { describe, expect, it } from "vitest";

import {
  SuiteDefinitionV2Schema,
  type SuiteDefinitionV2,
} from "@/lib/contracts";
import {
  MAX_GUIDED_SUITE_DEPTH,
  SuiteCompilerError,
  compileGuidedSuiteDraft,
} from "@/lib/suite-compiler";
import { adversarialGuidedDrafts } from "../fixtures/guided-suite/adversarial";
import financeDraft from "../fixtures/guided-suite/finance.json";
import salesDraft from "../fixtures/guided-suite/sales.json";
import supportDraft from "../fixtures/guided-suite/support.json";

const GOLDEN_DRAFTS = [
  {
    domain: "sales",
    input: salesDraft,
    id: "sales-renewal-safety",
    untrustedTool: "get_meeting",
    consequentialTool: "send_reply",
    protectedPath: "drafts.0.status",
  },
  {
    domain: "support",
    input: supportDraft,
    id: "support-escalation-safety",
    untrustedTool: "get_ticket",
    consequentialTool: "escalate_ticket",
    protectedPath: "tickets.0.status",
  },
  {
    domain: "finance",
    input: financeDraft,
    id: "finance-release-safety",
    untrustedTool: "get_payment_request",
    consequentialTool: "release_payment",
    protectedPath: "payments.0.status",
  },
] as const;

function compileFailure(input: unknown): SuiteCompilerError {
  try {
    compileGuidedSuiteDraft(input);
  } catch (error) {
    expect(error).toBeInstanceOf(SuiteCompilerError);
    return error as SuiteCompilerError;
  }
  throw new Error("Expected the guided suite compiler to reject this fixture");
}

function scenarioOf(suite: SuiteDefinitionV2) {
  const scenario = suite.scenarios[0];
  expect(scenario).toBeDefined();
  return scenario;
}

describe("guided suite compiler golden corpus", () => {
  it.each(GOLDEN_DRAFTS)(
    "compiles the independent $domain draft into a deterministic V2 safety contract",
    ({ input, id, untrustedTool, consequentialTool, protectedPath }) => {
      const original = structuredClone(input);
      const first = compileGuidedSuiteDraft(input);
      const second = compileGuidedSuiteDraft(structuredClone(input));

      expect(SuiteDefinitionV2Schema.parse(first)).toEqual(first);
      expect(first).toEqual(second);
      expect(input).toEqual(original);
      expect(first).toMatchObject({
        schemaVersion: 2,
        id,
        syntheticData: true,
        contractDesign: {
          untrustedContentTool: untrustedTool,
          consequentialMutationTool: consequentialTool,
          protectedState: { path: protectedPath },
        },
      });

      const scenario = scenarioOf(first);
      expect(scenario.enabledTools).toEqual(first.tools.map((tool) => tool.name));
      expect(new Set(scenario.assertions.map((assertion) => assertion.category))).toEqual(
        new Set(["taskOutcome", "trajectory", "safety", "recovery"]),
      );
      expect(
        scenario.walkthroughs.success.some(
          (event) => event.type === "state_change",
        ),
      ).toBe(true);
      expect(scenario.walkthroughs.success).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "confirmation_requested",
            toolName: consequentialTool,
          }),
          expect.objectContaining({
            type: "action_blocked",
            toolName: consequentialTool,
          }),
        ]),
      );
      expect(
        scenario.walkthroughs.failure.some(
          (event) =>
            event.type === "state_change" &&
            event.toolName === consequentialTool,
        ),
      ).toBe(true);
      expect(
        scenario.walkthroughs.successFinalState,
      ).toEqual(input.expected.safe.finalState);
      expect(
        scenario.walkthroughs.failureFinalState,
      ).toEqual(input.expected.unsafe.finalState);
    },
  );

  it("proves the support and finance suites are authored without sales-specific tools or state", () => {
    const support = compileGuidedSuiteDraft(supportDraft);
    const finance = compileGuidedSuiteDraft(financeDraft);
    const nonSales = [support, finance];

    for (const suite of nonSales) {
      const serialized = JSON.stringify(suite);
      expect(serialized).not.toContain("get_meeting");
      expect(serialized).not.toContain("send_reply");
      expect(serialized).not.toContain("drafts.0.status");
      expect(suite.contractDesign.protectedState.path).not.toBe(
        "drafts.0.status",
      );
    }
  });
});

describe("guided suite compiler adversarial corpus", () => {
  it.each(adversarialGuidedDrafts())(
    "rejects $name with a path-addressable issue",
    ({ input, expectedCode, expectedPath }) => {
      const error = compileFailure(input);
      expect(error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: expectedCode,
            path: expectedPath.split(".").map((segment) =>
              /^\d+$/.test(segment) ? Number(segment) : segment,
            ),
          }),
        ]),
      );
      expect(error.message).toContain(expectedPath);
    },
  );

  it("does not pollute Object.prototype while rejecting reserved object keys", () => {
    for (const fixture of adversarialGuidedDrafts().filter(({ name }) =>
      /__proto__|constructor|prototype/.test(name),
    )) {
      compileFailure(fixture.input);
    }

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects deeply nested JSON before schema parsing can exhaust the stack", () => {
    const input = structuredClone(salesDraft) as unknown as Record<string, unknown>;
    let cursor = input.syntheticState as Record<string, unknown>;
    for (let depth = 0; depth <= MAX_GUIDED_SUITE_DEPTH; depth += 1) {
      cursor.nested = {};
      cursor = cursor.nested as Record<string, unknown>;
    }

    const error = compileFailure(input);
    expect(error.issues).toContainEqual(
      expect.objectContaining({
        code: "invalid_draft",
        message: expect.stringContaining("nesting limit"),
      }),
    );
  });
});
