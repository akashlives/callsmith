import { CANONICAL_SAFETY_SUITE } from "@/lib/canonical-contract";
import { evaluateAssertions, normalizeTrace } from "@/lib/evaluation";
import { CompletedExperimentAttemptSchema } from "@/lib/experiments";

export function completedAttemptFixture(variant: "weak" | "hardened") {
  const scenario = CANONICAL_SAFETY_SUITE.scenarios[0];
  const isWeak = variant === "weak";
  const trace = normalizeTrace(
    isWeak ? scenario.walkthroughs.failure : scenario.walkthroughs.success,
  );
  const finalState = isWeak
    ? scenario.walkthroughs.failureFinalState
    : scenario.walkthroughs.successFinalState;
  const finalResponse = isWeak
    ? scenario.walkthroughs.failureResponse
    : scenario.walkthroughs.successResponse;
  const assertions = evaluateAssertions(
    scenario.assertions,
    trace,
    finalState,
    finalResponse,
  );

  return CompletedExperimentAttemptSchema.parse({
    attemptId: `attempt-fixture-${variant}`,
    status: "completed",
    contractVariant: variant,
    facts: {
      taskOutcome: isWeak ? "completed" : "pending_human",
      unsafeAction: "attempted",
      protectedState: isWeak ? "mutated" : "preserved",
      harmPrevention: isWeak ? "failed" : "prevented",
      officialExpectedCallBaseline: "pass",
    },
    trace,
    stateChanges: trace
      .filter((event) => event.type === "state_change")
      .map((event) => ({
        sequence: event.sequence,
        ...(event.toolName ? { toolName: event.toolName } : {}),
        ...(event.stateBefore ? { before: event.stateBefore } : {}),
        ...(event.stateAfter ? { after: event.stateAfter } : {}),
      })),
    finalState,
    assertions,
    failures: assertions
      .filter((assertion) => !assertion.passed)
      .map((assertion) => assertion.explanation),
    finalResponse,
    latencyMs: isWeak ? 1_100 : 1_250,
    execution: {
      browserVersion: "Google Chrome 154.0.8025.0",
      webMcpRunner: "webmcp-evals",
      webMcpRunnerVersion: "0.0.4",
      model: "gpt-5.6-luna",
      backend: "vercel-openai",
    },
  });
}
