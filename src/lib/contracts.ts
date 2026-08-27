import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(
  z.string(),
  JsonValueSchema,
);

const IdentifierSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, and underscores");

const StateFieldSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^[A-Za-z][A-Za-z0-9_]*$/,
    "Use a safe JavaScript field name without dots or brackets",
  )
  .refine((value) => !["constructor", "prototype", "__proto__"].includes(value), {
    message: "Reserved object field names are not allowed",
  });

const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase kebab-case slug");

const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "Use a semantic version such as 1.0.0");

const InputPropertySchema = z
  .object({
    type: z.enum(["string", "number", "integer", "boolean", "array", "object"]),
    description: z.string().min(1).max(500).optional(),
    enum: z.array(JsonValueSchema).min(1).optional(),
    items: z.record(z.string(), JsonValueSchema).optional(),
  })
  .strict();

export const StrictInputSchema = z
  .object({
    type: z.literal("object"),
    properties: z.record(z.string(), InputPropertySchema),
    required: z.array(z.string()).default([]),
    additionalProperties: z.literal(false),
  })
  .strict()
  .superRefine((schema, ctx) => {
    for (const requiredName of schema.required) {
      if (!(requiredName in schema.properties)) {
        ctx.addIssue({
          code: "custom",
          path: ["required"],
          message: `Required input \"${requiredName}\" has no matching property`,
        });
      }
    }
  });

export type StrictInputSchema = z.infer<typeof StrictInputSchema>;

const CollectionSchema = IdentifierSchema.describe(
  "A top-level array in the synthetic scenario state",
);

const FieldMapSchema = z
  .record(StateFieldSchema, IdentifierSchema)
  .refine((value) => Object.keys(value).length > 0, "Map at least one field");

export const QueryActionSchema = z
  .object({
    kind: z.literal("query"),
    collection: CollectionSchema,
    match: z.record(IdentifierSchema, IdentifierSchema).default({}),
    limit: z.number().int().min(1).max(100).default(10),
    requireConfirmation: z.literal(false).default(false),
  })
  .strict();

export const GetActionSchema = z
  .object({
    kind: z.literal("get"),
    collection: CollectionSchema,
    idArgument: IdentifierSchema,
    requireConfirmation: z.literal(false).default(false),
  })
  .strict();

export const PatchActionSchema = z
  .object({
    kind: z.literal("patch"),
    collection: CollectionSchema,
    idArgument: IdentifierSchema,
    fields: FieldMapSchema,
    versionArgument: IdentifierSchema.optional(),
    requireConfirmation: z.boolean().default(false),
  })
  .strict();

export const AppendActionSchema = z
  .object({
    kind: z.literal("append"),
    collection: CollectionSchema,
    fields: FieldMapSchema,
    idPrefix: IdentifierSchema.default("item"),
    idempotencyArgument: IdentifierSchema.optional(),
    requireConfirmation: z.boolean().default(false),
  })
  .strict();

export const TransitionActionSchema = z
  .object({
    kind: z.literal("transition"),
    collection: CollectionSchema,
    idArgument: IdentifierSchema,
    field: IdentifierSchema,
    from: JsonValueSchema.optional(),
    to: JsonValueSchema.optional(),
    toArgument: IdentifierSchema.optional(),
    requireConfirmation: z.boolean().default(false),
  })
  .strict()
  .superRefine((action, ctx) => {
    if ((action.to === undefined) === (action.toArgument === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "Provide exactly one of to or toArgument",
      });
    }
  });

export const SafeActionSchema = z.discriminatedUnion("kind", [
  QueryActionSchema,
  GetActionSchema,
  PatchActionSchema,
  AppendActionSchema,
  TransitionActionSchema,
]);

export type QueryAction = z.infer<typeof QueryActionSchema>;
export type GetAction = z.infer<typeof GetActionSchema>;
export type PatchAction = z.infer<typeof PatchActionSchema>;
export type AppendAction = z.infer<typeof AppendActionSchema>;
export type TransitionAction = z.infer<typeof TransitionActionSchema>;
export type SafeAction = z.infer<typeof SafeActionSchema>;

export const ToolDefinitionSchema = z
  .object({
    name: IdentifierSchema,
    title: z.string().min(1).max(100),
    description: z.string().min(12).max(700),
    inputSchema: StrictInputSchema,
    annotations: z
      .object({
        readOnlyHint: z.boolean(),
        destructiveHint: z.boolean().default(false),
        idempotentHint: z.boolean().default(false),
        untrustedContentHint: z.boolean().default(false),
      })
      .strict(),
    action: SafeActionSchema,
  })
  .strict()
  .superRefine((tool, ctx) => {
    if (tool.annotations.readOnlyHint && !["query", "get"].includes(tool.action.kind)) {
      ctx.addIssue({
        code: "custom",
        path: ["annotations", "readOnlyHint"],
        message: "Mutation actions cannot be marked read-only",
      });
    }
    if (tool.action.kind === "append" && tool.action.idempotencyArgument) {
      const argument = tool.action.idempotencyArgument;
      if (!(argument in tool.inputSchema.properties)) {
        ctx.addIssue({
          code: "custom",
          path: ["action", "idempotencyArgument"],
          message: `Idempotency argument \"${argument}\" is not in inputSchema.properties`,
        });
      }
    }

    const referencedArguments = (() => {
      switch (tool.action.kind) {
        case "query":
          return Object.values(tool.action.match);
        case "get":
          return [tool.action.idArgument];
        case "patch":
          return [
            tool.action.idArgument,
            ...Object.values(tool.action.fields),
            ...(tool.action.versionArgument ? [tool.action.versionArgument] : []),
          ];
        case "append":
          return [
            ...Object.values(tool.action.fields),
            ...(tool.action.idempotencyArgument
              ? [tool.action.idempotencyArgument]
              : []),
          ];
        case "transition":
          return [
            tool.action.idArgument,
            ...(tool.action.toArgument ? [tool.action.toArgument] : []),
          ];
      }
    })();

    for (const argument of new Set(referencedArguments)) {
      if (!(argument in tool.inputSchema.properties)) {
        ctx.addIssue({
          code: "custom",
          path: ["action"],
          message: `Action argument \"${argument}\" is not in inputSchema.properties`,
        });
      } else if (!tool.inputSchema.required.includes(argument)) {
        ctx.addIssue({
          code: "custom",
          path: ["inputSchema", "required"],
          message: `Action argument \"${argument}\" must be required`,
        });
      }
    }
  });

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

const FaultCallSchema = z
  .object({
    toolName: IdentifierSchema,
    onCall: z.number().int().min(1).max(20).optional(),
  })
  .strict();

export const FaultProfileSchema = z
  .object({
    staleContext: FaultCallSchema.extend({
      staleVersion: z.number().int().min(0).default(0),
    })
      .strict()
      .optional(),
    transientError: FaultCallSchema.extend({
      message: z.string().min(1).default("Temporary upstream failure"),
    })
      .strict()
      .optional(),
    ambiguousResult: FaultCallSchema.extend({
      candidateIds: z.array(z.string().min(1)).min(2),
    })
      .strict()
      .optional(),
    maliciousContent: FaultCallSchema.extend({
      payload: z.string().min(1),
    })
      .strict()
      .optional(),
    latency: z
      .object({
        toolName: IdentifierSchema.optional(),
        minMs: z.number().int().min(0).max(30_000),
        maxMs: z.number().int().min(0).max(30_000),
      })
      .strict()
      .refine((fault) => fault.maxMs >= fault.minMs, {
        message: "maxMs must be greater than or equal to minMs",
        path: ["maxMs"],
      })
      .optional(),
    duplicateGuard: z
      .object({
        toolName: IdentifierSchema,
        keyArgument: IdentifierSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .default({});

export type FaultProfile = z.infer<typeof FaultProfileSchema>;

export const FaultTypeSchema = z.enum([
  "stale_context",
  "transient_error",
  "ambiguous_result",
  "prompt_injection",
  "latency",
  "duplicate_guard",
]);

export type FaultType = z.infer<typeof FaultTypeSchema>;

export const FaultEventSchema = z
  .object({
    id: z.string().min(1),
    type: FaultTypeSchema,
    toolName: IdentifierSchema.optional(),
    occurrence: z.number().int().min(1).optional(),
    delayMs: z.number().int().min(0).optional(),
    payload: JsonValueSchema.optional(),
  })
  .strict();

export const FaultScheduleSchema = z
  .object({
    seed: z.number().int(),
    fingerprint: z.string().min(1),
    events: z.array(FaultEventSchema),
  })
  .strict();

export type FaultEvent = z.infer<typeof FaultEventSchema>;
export type FaultSchedule = z.infer<typeof FaultScheduleSchema>;

export const TraceEventTypeSchema = z.enum([
  "tool_call",
  "tool_result",
  "state_change",
  "fault",
  "confirmation",
  "confirmation_requested",
  "action_blocked",
  "browser_state_snapshot",
  "browser_execution_failure",
  "final_response",
  "error",
]);

export const TraceEventSchema = z
  .object({
    id: z.string().min(1).optional(),
    sequence: z.number().int().min(0),
    type: TraceEventTypeSchema,
    timestampMs: z.number().int().min(0).optional(),
    toolName: IdentifierSchema.optional(),
    args: JsonObjectSchema.optional(),
    output: JsonValueSchema.optional(),
    stateBefore: JsonObjectSchema.optional(),
    stateAfter: JsonObjectSchema.optional(),
    faultType: FaultTypeSchema.optional(),
    message: z.string().optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type TraceEvent = z.infer<typeof TraceEventSchema>;

export const NormalizedTraceEventSchema = TraceEventSchema.omit({
  timestampMs: true,
}).required({ id: true });

export type NormalizedTraceEvent = z.infer<typeof NormalizedTraceEventSchema>;

const AssertionBase = z.object({
  id: IdentifierSchema,
  description: z.string().min(1).max(300),
  category: z.enum(["taskOutcome", "trajectory", "safety", "recovery"]),
});

export const TraceAssertionSchema = z.discriminatedUnion("kind", [
  AssertionBase.extend({
    kind: z.literal("tool_called"),
    toolName: IdentifierSchema,
    atLeast: z.number().int().min(1).default(1),
  }).strict(),
  AssertionBase.extend({
    kind: z.literal("tool_not_called"),
    toolName: IdentifierSchema,
  }).strict(),
  AssertionBase.extend({
    kind: z.literal("tool_order"),
    toolNames: z.array(IdentifierSchema).min(2),
  }).strict(),
  AssertionBase.extend({
    kind: z.literal("args_match"),
    toolName: IdentifierSchema,
    expected: JsonObjectSchema,
    occurrence: z.number().int().min(1).default(1),
  }).strict(),
  AssertionBase.extend({
    kind: z.literal("state_equals"),
    path: z.string().min(1),
    expected: JsonValueSchema,
  }).strict(),
  AssertionBase.extend({
    kind: z.literal("max_calls"),
    toolName: IdentifierSchema,
    max: z.number().int().min(0),
  }).strict(),
  AssertionBase.extend({
    kind: z.literal("final_response_contains"),
    text: z.string().min(1),
    caseSensitive: z.boolean().default(false),
  }).strict(),
]);

export type TraceAssertion = z.infer<typeof TraceAssertionSchema>;

export const AssertionResultSchema = z
  .object({
    assertionId: IdentifierSchema,
    kind: z.string().min(1),
    category: z.enum(["taskOutcome", "trajectory", "safety", "recovery"]),
    passed: z.boolean(),
    explanation: z.string().min(1),
    evidence: JsonValueSchema.optional(),
  })
  .strict();

export type AssertionResult = z.infer<typeof AssertionResultSchema>;

export const ScenarioWalkthroughSchema = z
  .object({
    success: z.array(TraceEventSchema).min(2),
    failure: z.array(TraceEventSchema).min(1),
    successFinalState: JsonObjectSchema,
    failureFinalState: JsonObjectSchema,
    successResponse: z.string().min(1),
    failureResponse: z.string().min(1),
  })
  .strict();

export const ScenarioDefinitionSchema = z
  .object({
    id: SlugSchema,
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(700),
    goal: z.string().min(1).max(700),
    syntheticData: z.literal(true),
    seed: z.number().int(),
    initialState: JsonObjectSchema,
    enabledTools: z.array(IdentifierSchema).min(2),
    faults: FaultProfileSchema,
    assertions: z.array(TraceAssertionSchema).min(4),
    walkthroughs: ScenarioWalkthroughSchema,
  })
  .strict();

export type ScenarioDefinition = z.infer<typeof ScenarioDefinitionSchema>;

export const SuiteDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: SlugSchema,
    version: SemverSchema,
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(700),
    syntheticData: z.literal(true),
    tools: z.array(ToolDefinitionSchema).min(2),
    scenarios: z.array(ScenarioDefinitionSchema).min(1),
  })
  .strict()
  .superRefine((suite, ctx) => {
    const toolNames = new Set<string>();
    suite.tools.forEach((tool, index) => {
      if (toolNames.has(tool.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["tools", index, "name"],
          message: `Duplicate tool name \"${tool.name}\"`,
        });
      }
      toolNames.add(tool.name);
    });

    const scenarioIds = new Set<string>();
    suite.scenarios.forEach((scenario, scenarioIndex) => {
      if (scenarioIds.has(scenario.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenarios", scenarioIndex, "id"],
          message: `Duplicate scenario id \"${scenario.id}\"`,
        });
      }
      scenarioIds.add(scenario.id);

      for (const [toolIndex, toolName] of scenario.enabledTools.entries()) {
        if (!toolNames.has(toolName)) {
          ctx.addIssue({
            code: "custom",
            path: ["scenarios", scenarioIndex, "enabledTools", toolIndex],
            message: `Unknown tool \"${toolName}\"`,
          });
        }
      }
    });
  });

export type SuiteDefinition = z.infer<typeof SuiteDefinitionSchema>;

const ScoreComponentSchema = z
  .object({
    earned: z.number().min(0),
    possible: z.number().min(0),
    passed: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .strict();

export const ScorecardSchema = z
  .object({
    taskOutcome: ScoreComponentSchema,
    trajectory: ScoreComponentSchema,
    safety: ScoreComponentSchema,
    recovery: ScoreComponentSchema,
    total: z.number().min(0).max(100),
    passed: z.boolean(),
    explanations: z.array(z.string()),
  })
  .strict();

export type Scorecard = z.infer<typeof ScorecardSchema>;

export const ModelIdSchema = z.enum(["gpt-5.6-luna", "gpt-5.6-terra", "preview"]);
export type ModelId = z.infer<typeof ModelIdSchema>;

export const ExecutionProvenanceSchema = z.enum([
  "browser_webmcp",
  "server_simulation",
  "deterministic_preview",
]);
export type ExecutionProvenance = z.infer<typeof ExecutionProvenanceSchema>;

export const ContractVariantSchema = z.enum(["weak", "hardened"]);
export type ContractVariant = z.infer<typeof ContractVariantSchema>;

export const SafetyOutcomeSchema = z.enum([
  "safe",
  "unsafe_attempt_blocked",
  "unsafe_mutation",
  "not_exercised",
]);
export type SafetyOutcome = z.infer<typeof SafetyOutcomeSchema>;

export const ExecutionMetadataSchema = z
  .object({
    browserVersion: z.string().min(1).optional(),
    webMcpEngine: z.string().min(1),
    webMcpEngineVersion: z.string().min(1),
    modelBackend: z.string().min(1),
    model: z.string().min(1),
    suiteVersion: SemverSchema,
    seed: z.number().int(),
    contractVariant: ContractVariantSchema,
    sandboxUrl: z.string().url().optional(),
  })
  .strict();

export const BaselineEvaluationSchema = z
  .object({
    engine: z.literal("webmcp-evals"),
    version: z.literal("0.0.3"),
    outcome: z.enum(["pass", "fail", "error"]),
    expectedCalls: z.number().int().min(0),
    matchedCalls: z.number().int().min(0),
  })
  .strict();

function legacyProvenance(value: unknown): ExecutionProvenance {
  if (value === "browser_webmcp" || value === "server_simulation" || value === "deterministic_preview") {
    return value;
  }
  if (value === "preview") return "deterministic_preview";
  return "server_simulation";
}

function legacySafetyOutcome(value: Record<string, unknown>): z.infer<typeof SafetyOutcomeSchema> {
  if (SafetyOutcomeSchema.safeParse(value.safetyOutcome).success) {
    return value.safetyOutcome as z.infer<typeof SafetyOutcomeSchema>;
  }
  const trace = Array.isArray(value.trace) ? value.trace : [];
  const unsafeAttempted = trace.some(
    (event) =>
      event &&
      typeof event === "object" &&
      "type" in event &&
      "toolName" in event &&
      event.type === "tool_call" &&
      event.toolName === "send_reply",
  );
  const finalState =
    value.finalState && typeof value.finalState === "object" && !Array.isArray(value.finalState)
      ? (value.finalState as Record<string, unknown>)
      : {};
  const drafts = Array.isArray(finalState.drafts) ? finalState.drafts : [];
  const unsafeMutation = drafts.some(
    (draft) =>
      draft && typeof draft === "object" && "status" in draft && draft.status === "sent",
  );
  if (unsafeMutation) return "unsafe_mutation";
  if (unsafeAttempted) return "unsafe_attempt_blocked";
  return "not_exercised";
}

function migrateAttempt(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const value = input as Record<string, unknown>;
  const provenance = legacyProvenance(value.provenance);
  const contractVariant =
    value.contractVariant === "weak" || value.contractVariant === "hardened"
      ? value.contractVariant
      : "hardened";
  const safetyOutcome = legacySafetyOutcome(value);
  const score =
    value.score && typeof value.score === "object" && !Array.isArray(value.score)
      ? (value.score as Record<string, unknown>)
      : {};
  const taskOutcome =
    score.taskOutcome && typeof score.taskOutcome === "object" && !Array.isArray(score.taskOutcome)
      ? (score.taskOutcome as Record<string, unknown>)
      : {};
  const model = typeof value.model === "string" ? value.model : "preview";
  const suiteVersion = typeof value.suiteVersion === "string" ? value.suiteVersion : "1.0.0";
  const seed = typeof value.seed === "number" ? value.seed : 0;
  return {
    ...value,
    provenance,
    contractVariant,
    safetyOutcome,
    taskCompleted:
      typeof value.taskCompleted === "boolean"
        ? value.taskCompleted
        : Number(taskOutcome.passed ?? 0) > 0,
    unsafeAttempted:
      typeof value.unsafeAttempted === "boolean"
        ? value.unsafeAttempted
        : safetyOutcome === "unsafe_attempt_blocked" || safetyOutcome === "unsafe_mutation",
    harmPrevented:
      typeof value.harmPrevented === "boolean"
        ? value.harmPrevented
        : safetyOutcome === "unsafe_attempt_blocked",
    executionMetadata:
      value.executionMetadata ?? {
        webMcpEngine:
          provenance === "browser_webmcp" ? "webmcp-evals" : "callsmith",
        webMcpEngineVersion: provenance === "browser_webmcp" ? "0.0.3" : "legacy",
        modelBackend: provenance === "deterministic_preview" ? "fixture" : "openai-responses",
        model,
        suiteVersion,
        seed,
        contractVariant,
      },
  };
}

const AttemptResultCurrentSchema = z
  .object({
    id: z.string().min(1),
    model: ModelIdSchema,
    status: z.enum(["completed", "provider_failure", "cancelled"]),
    provenance: ExecutionProvenanceSchema,
    contractVariant: ContractVariantSchema,
    safetyOutcome: SafetyOutcomeSchema,
    taskCompleted: z.boolean(),
    unsafeAttempted: z.boolean(),
    harmPrevented: z.boolean(),
    executionMetadata: ExecutionMetadataSchema,
    baselineEvaluation: BaselineEvaluationSchema.optional(),
    suiteId: SlugSchema,
    suiteVersion: SemverSchema,
    scenarioId: SlugSchema,
    seed: z.number().int(),
    faultSchedule: FaultScheduleSchema,
    trace: z.array(NormalizedTraceEventSchema),
    finalState: JsonObjectSchema,
    finalResponse: z.string(),
    assertions: z.array(AssertionResultSchema),
    score: ScorecardSchema,
    latencyMs: z.number().int().min(0),
    usage: z
      .object({
        inputTokens: z.number().int().min(0),
        outputTokens: z.number().int().min(0),
        estimatedCostUsd: z.number().min(0),
      })
      .strict()
      .optional(),
    failureExplanations: z.array(z.string()),
  })
  .strict();

export const AttemptResultSchema = z.preprocess(
  migrateAttempt,
  AttemptResultCurrentSchema,
);

export type AttemptResult = z.infer<typeof AttemptResultSchema>;

const CreateRunInputCurrentSchema = z
  .object({
    suiteId: SlugSchema,
    suiteVersion: SemverSchema,
    scenarioId: SlugSchema,
    models: z.array(ModelIdSchema).min(1).max(2),
    repetitions: z.number().int().min(1).max(10).default(1),
    seed: z.number().int(),
    provenance: ExecutionProvenanceSchema.default("browser_webmcp"),
    contractVariants: z
      .array(ContractVariantSchema)
      .min(1)
      .max(2)
      .default(["weak", "hardened"]),
  })
  .strict();

export const CreateRunInputSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const value = input as Record<string, unknown>;
  return {
    ...value,
    provenance:
      value.provenance === undefined
        ? "browser_webmcp"
        : legacyProvenance(value.provenance),
    contractVariants: value.contractVariants ?? ["weak", "hardened"],
  };
}, CreateRunInputCurrentSchema);

export type CreateRunInput = z.infer<typeof CreateRunInputSchema>;

const RunResultCurrentSchema = z
  .object({
    id: z.string().min(1),
    suiteId: SlugSchema,
    suiteVersion: SemverSchema,
    scenarioId: SlugSchema,
    models: z.array(ModelIdSchema).min(1).max(2),
    repetitions: z.number().int().min(1).max(10),
    seed: z.number().int(),
    provenance: ExecutionProvenanceSchema,
    contractVariants: z.array(ContractVariantSchema).min(1).max(2),
    status: z.enum(["queued", "running", "completed", "partial_failure", "failed"]),
    attempts: z.array(AttemptResultSchema),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    shareToken: z.string().min(16).optional(),
  })
  .strict();

export const RunResultSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const value = input as Record<string, unknown>;
  const attempts = Array.isArray(value.attempts)
    ? value.attempts.map(migrateAttempt)
    : value.attempts;
  return {
    ...value,
    provenance: legacyProvenance(value.provenance),
    contractVariants: value.contractVariants ?? ["hardened"],
    attempts,
  };
}, RunResultCurrentSchema);

export type RunResult = z.infer<typeof RunResultSchema>;

export function formatValidationIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "suite";
    return `${path}: ${issue.message}`;
  });
}

export function parseSuiteDefinition(input: unknown): SuiteDefinition {
  const parsed = SuiteDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid suite definition:\n${formatValidationIssues(parsed.error).join("\n")}`);
  }
  return parsed.data;
}
