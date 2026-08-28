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

const StrictInputSchema = z
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

const CollectionSchema = IdentifierSchema.describe(
  "A top-level array in the synthetic scenario state",
);

const FieldMapSchema = z
  .record(StateFieldSchema, IdentifierSchema)
  .refine((value) => Object.keys(value).length > 0, "Map at least one field");

const QueryActionSchema = z
  .object({
    kind: z.literal("query"),
    collection: CollectionSchema,
    match: z.record(IdentifierSchema, IdentifierSchema).default({}),
    limit: z.number().int().min(1).max(100).default(10),
    requireConfirmation: z.literal(false).default(false),
  })
  .strict();

const GetActionSchema = z
  .object({
    kind: z.literal("get"),
    collection: CollectionSchema,
    idArgument: IdentifierSchema,
    requireConfirmation: z.literal(false).default(false),
  })
  .strict();

const PatchActionSchema = z
  .object({
    kind: z.literal("patch"),
    collection: CollectionSchema,
    idArgument: IdentifierSchema,
    fields: FieldMapSchema,
    versionArgument: IdentifierSchema.optional(),
    requireConfirmation: z.boolean().default(false),
  })
  .strict();

const AppendActionSchema = z
  .object({
    kind: z.literal("append"),
    collection: CollectionSchema,
    fields: FieldMapSchema,
    idPrefix: IdentifierSchema.default("item"),
    idempotencyArgument: IdentifierSchema.optional(),
    requireConfirmation: z.boolean().default(false),
  })
  .strict();

const TransitionActionSchema = z
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

const SafeActionSchema = z.discriminatedUnion("kind", [
  QueryActionSchema,
  GetActionSchema,
  PatchActionSchema,
  AppendActionSchema,
  TransitionActionSchema,
]);

export type AppendAction = z.infer<typeof AppendActionSchema>;
export type SafeAction = z.infer<typeof SafeActionSchema>;

const ToolDefinitionSchema = z
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

const FaultProfileSchema = z
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

const FaultTypeSchema = z.enum([
  "stale_context",
  "transient_error",
  "ambiguous_result",
  "prompt_injection",
  "latency",
  "duplicate_guard",
]);

const TraceEventTypeSchema = z.enum([
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

const TraceAssertionSchema = z.discriminatedUnion("kind", [
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

const ScenarioWalkthroughSchema = z
  .object({
    success: z.array(TraceEventSchema).min(2),
    failure: z.array(TraceEventSchema).min(1),
    successFinalState: JsonObjectSchema,
    failureFinalState: JsonObjectSchema,
    successResponse: z.string().min(1),
    failureResponse: z.string().min(1),
  })
  .strict();

const ScenarioDefinitionSchema = z
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

const ProtectedStatePathSchema = z
  .string()
  .min(1)
  .max(300)
  .regex(
    /^[A-Za-z][A-Za-z0-9_]*(?:\.(?:[A-Za-z][A-Za-z0-9_]*|\d+))*$/,
    "Use a dotted state path with safe field names and numeric array indexes",
  )
  .refine(
    (path) =>
      !path
        .split(".")
        .some((segment) => ["constructor", "prototype", "__proto__"].includes(segment)),
    "Reserved object field names are not allowed in state paths",
  );

const ContractDesignSchema = z
  .object({
    untrustedContentTool: IdentifierSchema,
    consequentialMutationTool: IdentifierSchema,
    protectedState: z
      .object({
        path: ProtectedStatePathSchema,
        safeValue: JsonValueSchema,
        unsafeValue: JsonValueSchema,
      })
      .strict()
      .refine(
        (state) => JSON.stringify(state.safeValue) !== JSON.stringify(state.unsafeValue),
        {
          path: ["unsafeValue"],
          message: "Unsafe value must differ from the safe value",
        },
      ),
    confirmationTools: z.array(IdentifierSchema).min(1).max(24),
    idempotencyTools: z
      .array(
        z
          .object({
            toolName: IdentifierSchema,
            argument: IdentifierSchema,
          })
          .strict(),
      )
      .max(24),
  })
  .strict()
  .superRefine((design, ctx) => {
    const confirmationNames = new Set<string>();
    design.confirmationTools.forEach((toolName, index) => {
      if (confirmationNames.has(toolName)) {
        ctx.addIssue({
          code: "custom",
          path: ["confirmationTools", index],
          message: `Duplicate confirmation target \"${toolName}\"`,
        });
      }
      confirmationNames.add(toolName);
    });
    const idempotencyNames = new Set<string>();
    design.idempotencyTools.forEach((requirement, index) => {
      if (idempotencyNames.has(requirement.toolName)) {
        ctx.addIssue({
          code: "custom",
          path: ["idempotencyTools", index, "toolName"],
          message: `Duplicate idempotency target \"${requirement.toolName}\"`,
        });
      }
      idempotencyNames.add(requirement.toolName);
    });
  });

function valueAtContractPath(state: JsonObject, path: string): JsonValue | undefined {
  let cursor: JsonValue | undefined = state;
  for (const segment of path.split(".")) {
    if (Array.isArray(cursor)) {
      if (!/^\d+$/.test(segment)) return undefined;
      cursor = cursor[Number(segment)];
    } else if (cursor && typeof cursor === "object") {
      cursor = cursor[segment];
    } else {
      return undefined;
    }
  }
  return cursor;
}

export const SuiteDefinitionV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: SlugSchema,
    version: SemverSchema,
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(700),
    syntheticData: z.literal(true),
    contractDesign: ContractDesignSchema,
    tools: z.array(ToolDefinitionSchema).min(2),
    scenarios: z.array(ScenarioDefinitionSchema).min(1),
  })
  .strict()
  .superRefine((suite, ctx) => {
    const tools = new Map<string, ToolDefinition>();
    suite.tools.forEach((tool, index) => {
      if (tools.has(tool.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["tools", index, "name"],
          message: `Duplicate tool name \"${tool.name}\"`,
        });
      }
      tools.set(tool.name, tool);
    });

    const design = suite.contractDesign;
    const untrustedTool = tools.get(design.untrustedContentTool);
    if (!untrustedTool) {
      ctx.addIssue({
        code: "custom",
        path: ["contractDesign", "untrustedContentTool"],
        message: `Unknown tool \"${design.untrustedContentTool}\"`,
      });
    } else if (
      !untrustedTool.annotations.readOnlyHint ||
      !untrustedTool.annotations.untrustedContentHint
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["contractDesign", "untrustedContentTool"],
        message: "The untrusted-content tool must be read-only and annotated as untrusted",
      });
    }

    const consequentialTool = tools.get(design.consequentialMutationTool);
    if (!consequentialTool) {
      ctx.addIssue({
        code: "custom",
        path: ["contractDesign", "consequentialMutationTool"],
        message: `Unknown tool \"${design.consequentialMutationTool}\"`,
      });
    } else if (
      consequentialTool.annotations.readOnlyHint ||
      !consequentialTool.annotations.destructiveHint ||
      !consequentialTool.action.requireConfirmation
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["contractDesign", "consequentialMutationTool"],
        message:
          "The consequential tool must be a destructive mutation with confirmation required",
      });
    }

    if (!design.confirmationTools.includes(design.consequentialMutationTool)) {
      ctx.addIssue({
        code: "custom",
        path: ["contractDesign", "confirmationTools"],
        message: "Confirmation targets must include the consequential mutation tool",
      });
    }

    design.confirmationTools.forEach((toolName, index) => {
      const tool = tools.get(toolName);
      if (
        !tool ||
        tool.annotations.readOnlyHint ||
        !tool.action.requireConfirmation
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["contractDesign", "confirmationTools", index],
          message: `Confirmation target \"${toolName}\" must be a mutation with confirmation required`,
        });
      }
    });

    suite.tools.forEach((tool, index) => {
      if (
        tool.action.requireConfirmation &&
        !design.confirmationTools.includes(tool.name)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["tools", index, "action", "requireConfirmation"],
          message: `Confirmation-requiring tool \"${tool.name}\" must be declared in contractDesign.confirmationTools`,
        });
      }
    });

    design.idempotencyTools.forEach((requirement, index) => {
      const tool = tools.get(requirement.toolName);
      const actionArgument = (() => {
        if (tool?.action.kind === "append") return tool.action.idempotencyArgument;
        if (tool?.action.kind === "patch") return tool.action.versionArgument;
        return undefined;
      })();
      if (
        !tool ||
        !tool.annotations.idempotentHint ||
        actionArgument !== requirement.argument
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["contractDesign", "idempotencyTools", index],
          message:
            "Idempotency must target an idempotent append key or patch version argument",
        });
      }
    });

    const scenarioIds = new Set<string>();
    let participatingScenarios = 0;
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
        if (!tools.has(toolName)) {
          ctx.addIssue({
            code: "custom",
            path: ["scenarios", scenarioIndex, "enabledTools", toolIndex],
            message: `Unknown tool \"${toolName}\"`,
          });
        }
      }

      const duplicateGuard = scenario.faults.duplicateGuard;
      if (
        duplicateGuard &&
        !design.idempotencyTools.some(
          (requirement) =>
            requirement.toolName === duplicateGuard.toolName &&
            requirement.argument === duplicateGuard.keyArgument,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["scenarios", scenarioIndex, "faults", "duplicateGuard"],
          message:
            "Duplicate guard must match a declared contractDesign.idempotencyTools requirement",
        });
      }

      // Only scenarios exercising this declared untrusted-content boundary
      // participate in its protected-state validation.
      if (
        scenario.faults.maliciousContent?.toolName !==
        design.untrustedContentTool
      ) {
        return;
      }
      participatingScenarios += 1;

      const safeValue = valueAtContractPath(
        scenario.walkthroughs.successFinalState,
        design.protectedState.path,
      );
      const unsafeValue = valueAtContractPath(
        scenario.walkthroughs.failureFinalState,
        design.protectedState.path,
      );
      if (JSON.stringify(safeValue) !== JSON.stringify(design.protectedState.safeValue)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenarios", scenarioIndex, "walkthroughs", "successFinalState"],
          message: `Safe final state must set ${design.protectedState.path} to the declared safe value`,
        });
      }
      if (JSON.stringify(unsafeValue) !== JSON.stringify(design.protectedState.unsafeValue)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenarios", scenarioIndex, "walkthroughs", "failureFinalState"],
          message: `Unsafe final state must set ${design.protectedState.path} to the declared unsafe value`,
        });
      }
    });
    if (participatingScenarios === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["scenarios"],
        message:
          "At least one scenario must inject malicious content through the declared untrusted-content tool",
      });
    }
  });

export type SuiteDefinitionV2 = z.infer<typeof SuiteDefinitionV2Schema>;

export type SuiteDefinition = SuiteDefinitionV2;

export const ContractVariantSchema = z.enum(["weak", "hardened"]);
export type ContractVariant = z.infer<typeof ContractVariantSchema>;

export type BaselineEvaluation = {
  engine: "webmcp-evals";
  version: string;
  outcome: "pass" | "fail" | "error";
  expectedCalls: number;
  matchedCalls: number;
};
