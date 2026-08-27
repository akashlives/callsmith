import { describe, expect, it } from "vitest";

import {
  SuiteDefinitionSchema,
  SuiteDefinitionV1Schema,
  SuiteDefinitionV2Schema,
  type GuidedSuiteDraft,
  type SuiteDefinitionV1,
} from "@/lib/contracts";
import {
  MAX_GUIDED_SUITE_BYTES,
  SuiteCompilerError,
  compileGuidedSuiteDraft,
  migrateSuiteDefinition,
} from "@/lib/suite-compiler";
import {
  SALES_GAUNTLET_SUITE,
  SUPPORT_ESCALATION_SUITE,
} from "@/lib/suites";

function supportDraft(): GuidedSuiteDraft {
  const support = SuiteDefinitionV1Schema.parse(SUPPORT_ESCALATION_SUITE);
  const scenario = support.scenarios[0];
  const calls = (variant: "success" | "failure") =>
    scenario.walkthroughs[variant]
      .filter(
        (event): event is typeof event & { toolName: string; args: NonNullable<typeof event.args> } =>
          event.type === "tool_call" && Boolean(event.toolName && event.args),
      )
      .map((event) => ({ toolName: event.toolName, args: event.args }));
  const safeCalls = calls("success");
  safeCalls.push({
    toolName: "escalate_ticket",
    args: { ticket_id: "ticket-001" },
  });

  return {
    draftVersion: 1,
    id: "support-escalation-guided",
    version: "2.0.0",
    title: "Support Escalation Guided Contract",
    domain: "customer-support",
    goal: scenario.goal,
    seed: scenario.seed,
    syntheticState: scenario.initialState,
    tools: support.tools,
    faults: scenario.faults,
    contractDesign: {
      untrustedContentTool: "get_ticket",
      consequentialMutationTool: "escalate_ticket",
      protectedState: {
        path: "tickets.0.status",
        safeValue: "new",
        unsafeValue: "escalated",
      },
      confirmationTools: ["escalate_ticket"],
      idempotencyTools: [
        { toolName: "create_investigation", argument: "request_id" },
      ],
    },
    expected: {
      safe: {
        calls: safeCalls,
        finalState: scenario.walkthroughs.successFinalState,
      },
      unsafe: {
        calls: calls("failure"),
        finalState: scenario.walkthroughs.failureFinalState,
      },
    },
  };
}

function compilerError(input: unknown): SuiteCompilerError {
  try {
    compileGuidedSuiteDraft(input);
  } catch (error) {
    expect(error).toBeInstanceOf(SuiteCompilerError);
    return error as SuiteCompilerError;
  }
  throw new Error("Expected guided draft compilation to fail");
}

describe("guided suite compiler", () => {
  it("compiles a non-sales golden draft into generic V2 assertions and walkthroughs", () => {
    const compiled = compileGuidedSuiteDraft(supportDraft());

    expect(SuiteDefinitionV2Schema.parse(compiled)).toEqual(compiled);
    expect(compiled).toMatchObject({
      schemaVersion: 2,
      id: "support-escalation-guided",
      contractDesign: {
        untrustedContentTool: "get_ticket",
        consequentialMutationTool: "escalate_ticket",
        confirmationTools: ["escalate_ticket"],
      },
    });
    expect(new Set(compiled.scenarios[0].assertions.map((item) => item.category))).toEqual(
      new Set(["taskOutcome", "trajectory", "safety", "recovery"]),
    );
    expect(compiled.scenarios[0].walkthroughs.success).toContainEqual(
      expect.objectContaining({ type: "final_response" }),
    );
    expect(compiled.scenarios[0].walkthroughs.failureFinalState).toMatchObject({
      tickets: [expect.objectContaining({ status: "escalated" })],
    });
  });

  it("continues reading V1 and migrates both built-in golden suites to V2", () => {
    expect(SuiteDefinitionSchema.parse(SALES_GAUNTLET_SUITE).schemaVersion).toBe(1);
    expect(SuiteDefinitionSchema.parse(SUPPORT_ESCALATION_SUITE).schemaVersion).toBe(1);

    const sales = migrateSuiteDefinition(SALES_GAUNTLET_SUITE);
    const support = migrateSuiteDefinition(SUPPORT_ESCALATION_SUITE);

    expect(sales.schemaVersion).toBe(2);
    expect(sales.contractDesign).toMatchObject({
      untrustedContentTool: "get_meeting_context",
      consequentialMutationTool: "send_reply",
      protectedState: { path: "drafts.0.status", safeValue: "draft", unsafeValue: "sent" },
    });
    expect(support.contractDesign.protectedState).toEqual({
      path: "tickets.0.status",
      safeValue: "new",
      unsafeValue: "escalated",
    });
  });

  it("rejects executable values, prototype keys, external URLs, and credential fields", () => {
    const executable = supportDraft() as unknown as Record<string, unknown>;
    executable.execute = "function () { return process.env.SECRET; }";
    expect(compilerError(executable).issues.map((issue) => issue.code)).toContain(
      "executable_content",
    );

    const poisoned = JSON.parse(JSON.stringify(supportDraft())) as Record<string, unknown>;
    (poisoned.syntheticState as Record<string, unknown>)["__proto__"] = {
      polluted: true,
    };
    expect(compilerError(poisoned).issues.map((issue) => issue.code)).toContain(
      "prototype_key",
    );

    const external = supportDraft();
    external.goal = "Review the support case at https://outside.example.invalid and finish safely.";
    expect(compilerError(external).issues.map((issue) => issue.code)).toContain(
      "executable_content",
    );

    const credentialed = supportDraft() as unknown as Record<string, unknown>;
    (credentialed.syntheticState as Record<string, unknown>).api_key = "redacted-value";
    const error = compilerError(credentialed);
    expect(error.issues.map((issue) => issue.code)).toContain("executable_content");
    expect(error.message).not.toContain("redacted-value");
  });

  it("rejects unknown collections and protected state paths with exact issue paths", () => {
    const unknownCollection = supportDraft();
    unknownCollection.tools[0].action.collection = "external_tickets";
    const collectionError = compilerError(unknownCollection);
    expect(collectionError.issues).toContainEqual(
      expect.objectContaining({
        code: "unknown_collection",
        path: ["tools", 0, "action", "collection"],
      }),
    );

    const unknownPath = supportDraft();
    unknownPath.contractDesign.protectedState.path = "tickets.0.unknownStatus";
    const pathError = compilerError(unknownPath);
    expect(pathError.issues).toContainEqual(
      expect.objectContaining({ code: "unknown_state_path" }),
    );
  });

  it("rejects missing confirmation, mismatched idempotency, and inconsistent final state", () => {
    const confirmation = supportDraft();
    confirmation.contractDesign.confirmationTools = ["create_investigation"];
    expect(compilerError(confirmation).issues.map((issue) => issue.code)).toContain(
      "missing_confirmation",
    );

    const idempotency = supportDraft();
    idempotency.contractDesign.idempotencyTools[0].argument = "ticket_id";
    expect(compilerError(idempotency).issues.map((issue) => issue.code)).toContain(
      "missing_idempotency",
    );

    const inconsistent = supportDraft();
    const investigations = inconsistent.expected.safe.finalState.investigations;
    if (
      !Array.isArray(investigations) ||
      !investigations[0] ||
      typeof investigations[0] !== "object" ||
      Array.isArray(investigations[0])
    ) {
      throw new Error("Golden fixture has no investigation item");
    }
    investigations[0].status = "closed";
    expect(compilerError(inconsistent).issues.map((issue) => issue.code)).toContain(
      "inconsistent_final_state",
    );
  });

  it("rejects invalid identifiers and drafts over 256KB", () => {
    const invalidIdentifier = supportDraft() as unknown as Record<string, unknown>;
    invalidIdentifier.id = "Support Draft";
    const identifierError = compilerError(invalidIdentifier);
    expect(identifierError.issues[0]).toMatchObject({ code: "invalid_draft", path: ["id"] });

    const oversized = supportDraft();
    oversized.faults.maliciousContent!.payload = "x".repeat(MAX_GUIDED_SUITE_BYTES);
    expect(compilerError(oversized).issues.map((issue) => issue.code)).toContain(
      "too_large",
    );
  });

  it("returns a defensive V2 clone when migration input is already V2", () => {
    const compiled = compileGuidedSuiteDraft(supportDraft());
    const migrated = migrateSuiteDefinition(compiled);
    expect(migrated).toEqual(compiled);
    expect(migrated).not.toBe(compiled);
  });
});

// Compile-time guard: the public V1 name remains available for callers that
// intentionally have not opted into V2 authoring yet.
const _v1Compatibility: SuiteDefinitionV1 = SuiteDefinitionV1Schema.parse(
  SUPPORT_ESCALATION_SUITE,
);
void _v1Compatibility;
