import { z } from "zod";

import {
  JsonObjectSchema,
  TraceEventSchema,
  type AttemptResult,
  type ContractVariant,
  type JsonValue,
  type ModelId,
  type ScenarioDefinition,
  type SuiteDefinition,
  type TraceEvent,
} from "@/lib/contracts";
import { createProviderFailureAttempt, evaluateAttempt } from "@/lib/evaluation";

const BrowserEvidenceEnvelopeSchema = z
  .object({
    provenance: z.literal("browser_webmcp"),
    suiteId: z.string().min(1),
    suiteVersion: z.string().min(1),
    scenarioId: z.string().min(1),
    contractVariant: z.enum(["weak", "hardened"]),
    seed: z.number().int(),
    attemptId: z.string().min(1).optional(),
    events: z.array(TraceEventSchema),
    stateSnapshot: JsonObjectSchema,
  })
  .strict();

type BrowserEvidenceEnvelope = z.infer<typeof BrowserEvidenceEnvelopeSchema>;

function parsedString(value: string): unknown {
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function collectEvidence(value: unknown): BrowserEvidenceEnvelope[] {
  const collected: BrowserEvidenceEnvelope[] = [];
  const visited = new Set<object>();

  const visit = (current: unknown) => {
    if (typeof current === "string") {
      const parsed = parsedString(current);
      if (parsed !== current) visit(parsed);
      return;
    }
    if (!current || typeof current !== "object") return;
    if (visited.has(current)) return;
    visited.add(current);

    if (!Array.isArray(current) && "callsmithEvidence" in current) {
      const candidate = BrowserEvidenceEnvelopeSchema.safeParse(
        (current as Record<string, unknown>).callsmithEvidence,
      );
      if (candidate.success) collected.push(candidate.data);
    }

    for (const nested of Array.isArray(current)
      ? current
      : Object.values(current as Record<string, unknown>)) {
      visit(nested);
    }
  };

  visit(value);
  return collected;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function resultRows(report: unknown): Record<string, unknown>[] {
  const root = record(report);
  const wrapper = record(root?.results);
  const rows = wrapper?.results;
  return Array.isArray(rows)
    ? rows.flatMap((row) => (record(row) ? [record(row)!] : []))
    : [];
}

function baselineFromReport(
  report: unknown,
  runnerVersion: string,
): AttemptResult["baselineEvaluation"] {
  const rows = resultRows(report);
  const expectedRows = rows.filter((row) => {
    const test = record(row.test);
    return Array.isArray(test?.expectedCall) && test.expectedCall.length > 0;
  });
  const matchedCalls = expectedRows.filter((row) => row.outcome === "pass").length;
  const anyError = rows.some((row) => row.outcome === "error");
  return {
    engine: "webmcp-evals",
    version: runnerVersion,
    outcome: anyError
      ? "error"
      : expectedRows.length > 0 && matchedCalls === expectedRows.length
        ? "pass"
        : "fail",
    expectedCalls: expectedRows.length,
    matchedCalls,
  };
}

function finalResponseFromReport(report: unknown): string {
  const candidates: string[] = [];
  for (const row of resultRows(report)) {
    const response = record(row.response);
    if (typeof response?.text === "string" && response.text.trim()) {
      candidates.push(response.text.trim());
    }
    if (!Array.isArray(row.trajectory)) continue;
    for (const stepValue of row.trajectory) {
      const step = record(stepValue);
      if (typeof step?.text === "string" && step.text.trim()) {
        candidates.push(step.text.trim());
      }
    }
  }
  return candidates.at(-1) ?? "The browser agent returned no final text.";
}

function normalizedBrowserTrace(envelopes: BrowserEvidenceEnvelope[]): TraceEvent[] {
  const trace: TraceEvent[] = [];
  for (const envelope of envelopes) {
    for (const event of envelope.events) {
      trace.push({ ...event, sequence: trace.length });
    }
  }
  return trace;
}

export type BrowserAttemptInput = {
  suite: SuiteDefinition;
  scenario: ScenarioDefinition;
  model: ModelId;
  seed: number;
  contractVariant: ContractVariant;
  browserVersion: string;
  sandboxUrl: string;
  latencyMs: number;
  runner: { name: string; version: string };
  modelBackend: string;
  report: unknown;
};

export function attemptFromBrowserReport(input: BrowserAttemptInput): AttemptResult {
  const seenEvidence = new Set<string>();
  const envelopes = collectEvidence(input.report).filter((envelope) => {
    if (
      envelope.suiteId !== input.suite.id ||
      envelope.scenarioId !== input.scenario.id ||
      envelope.contractVariant !== input.contractVariant ||
      envelope.seed !== input.seed
    ) {
      return false;
    }
    const fingerprint = JSON.stringify({
      attemptId: envelope.attemptId,
      events: envelope.events,
      stateSnapshot: envelope.stateSnapshot,
    });
    if (seenEvidence.has(fingerprint)) return false;
    seenEvidence.add(fingerprint);
    return true;
  });
  const metadata: AttemptResult["executionMetadata"] = {
    browserVersion: input.browserVersion,
    webMcpEngine: input.runner.name,
    webMcpEngineVersion: input.runner.version,
    modelBackend: input.modelBackend,
    model: input.model,
    suiteVersion: input.suite.version,
    seed: input.seed,
    contractVariant: input.contractVariant,
    sandboxUrl: input.sandboxUrl,
  };

  if (envelopes.length === 0) {
    return createProviderFailureAttempt(
      input.suite,
      input.scenario,
      input.model,
      input.seed,
      "The official browser runner returned no browser-originated Callsmith evidence.",
      input.latencyMs,
      {
        provenance: "browser_webmcp",
        contractVariant: input.contractVariant,
        executionMetadata: metadata,
        trace: [
          {
            sequence: 0,
            type: "browser_execution_failure",
            message:
              "No evidence envelope was recovered from document.modelContext tool results.",
          },
        ],
      },
    );
  }

  const trace = normalizedBrowserTrace(envelopes);
  const consoleErrors = resultRows(input.report).flatMap((row) =>
    Array.isArray(row.browserConsoleErrors) ? row.browserConsoleErrors : [],
  );
  for (const consoleError of consoleErrors) {
    const detail = record(consoleError);
    trace.push({
      sequence: trace.length,
      type: "browser_execution_failure",
      message:
        typeof detail?.message === "string"
          ? detail.message
          : "Browser console error occurred during WebMCP execution.",
      metadata: {
        source: "browser_console",
        ...(typeof detail?.kind === "string" ? { kind: detail.kind } : {}),
      },
    });
  }
  const finalResponse = finalResponseFromReport(input.report);
  trace.push({ sequence: trace.length, type: "final_response", message: finalResponse });

  return evaluateAttempt({
    suite: input.suite,
    scenario: input.scenario,
    model: input.model,
    seed: input.seed,
    trace,
    finalState: envelopes.at(-1)?.stateSnapshot ?? input.scenario.initialState,
    finalResponse,
    latencyMs: input.latencyMs,
    provenance: "browser_webmcp",
    contractVariant: input.contractVariant,
    executionMetadata: metadata,
    baselineEvaluation: baselineFromReport(input.report, input.runner.version),
    status: "completed",
  });
}

export function browserEvidenceSummary(report: unknown): JsonValue {
  const envelopes = collectEvidence(report);
  return {
    envelopes: envelopes.length,
    browserEvents: envelopes.reduce((sum, envelope) => sum + envelope.events.length, 0),
    baseline: baselineFromReport(report, "unreported") ?? null,
  };
}
