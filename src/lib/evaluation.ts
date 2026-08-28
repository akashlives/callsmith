import {
  type AppendAction,
  type AssertionResult,
  type JsonObject,
  type JsonValue,
  type NormalizedTraceEvent,
  type SafeAction,
  type TraceAssertion,
  type TraceEvent,
} from "@/lib/contracts";

const SECRET_KEY_PATTERN =
  /(?:api[-_]?key|authorization|credential|password|secret$|access[-_]?token|refresh[-_]?token)/i;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stableSerialize(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(",")}}`;
}

export function redactSecrets(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [
          key,
          SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSecrets(nested),
        ]),
    );
  }
  return value;
}

function normalizedJson(value: JsonValue | undefined): JsonValue | undefined {
  return value === undefined ? undefined : redactSecrets(value);
}

export function normalizeTrace(events: TraceEvent[]): NormalizedTraceEvent[] {
  return events
    .map((event, sourceIndex) => ({ event, sourceIndex }))
    .sort(
      (left, right) =>
        left.event.sequence - right.event.sequence || left.sourceIndex - right.sourceIndex,
    )
    .map(({ event }, index) => {
      const normalized: NormalizedTraceEvent = {
        id: `event-${String(index + 1).padStart(3, "0")}`,
        sequence: index,
        type: event.type,
      };
      if (event.toolName !== undefined) normalized.toolName = event.toolName;
      if (event.args !== undefined) normalized.args = normalizedJson(event.args) as JsonObject;
      if (event.output !== undefined) normalized.output = normalizedJson(event.output);
      if (event.stateBefore !== undefined) {
        normalized.stateBefore = normalizedJson(event.stateBefore) as JsonObject;
      }
      if (event.stateAfter !== undefined) {
        normalized.stateAfter = normalizedJson(event.stateAfter) as JsonObject;
      }
      if (event.faultType !== undefined) normalized.faultType = event.faultType;
      if (event.message !== undefined) normalized.message = event.message;
      if (event.metadata !== undefined) {
        normalized.metadata = normalizedJson(event.metadata) as JsonObject;
      }
      return normalized;
    });
}

function deepPartialMatch(actual: JsonValue | undefined, expected: JsonValue): boolean {
  if (expected === null || typeof expected !== "object") {
    return Object.is(actual, expected);
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((value, index) => deepPartialMatch(actual[index], value))
    );
  }
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    return false;
  }
  return Object.entries(expected).every(([key, value]) =>
    deepPartialMatch(actual[key], value),
  );
}

function getPath(root: JsonValue, path: string): JsonValue | undefined {
  let value: JsonValue | undefined = root;
  for (const segment of path.split(".")) {
    if (Array.isArray(value)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      value = value[index];
    } else if (value !== null && typeof value === "object") {
      value = value[segment];
    } else {
      return undefined;
    }
  }
  return value;
}

function toolCalls(trace: NormalizedTraceEvent[]): NormalizedTraceEvent[] {
  return trace.filter((event) => event.type === "tool_call");
}

function evaluateAssertion(
  assertion: TraceAssertion,
  trace: NormalizedTraceEvent[],
  finalState: JsonObject,
  finalResponseText: string,
): AssertionResult {
  const calls = toolCalls(trace);
  let passed = false;
  let explanation = "";
  let evidence: JsonValue | undefined;

  switch (assertion.kind) {
    case "tool_called": {
      const count = calls.filter((event) => event.toolName === assertion.toolName).length;
      passed = count >= assertion.atLeast;
      evidence = { count, required: assertion.atLeast };
      explanation = passed
        ? `${assertion.toolName} was called ${count} time${count === 1 ? "" : "s"}.`
        : `${assertion.toolName} was called ${count} time${count === 1 ? "" : "s"}; at least ${assertion.atLeast} required.`;
      break;
    }
    case "tool_not_called": {
      const count = calls.filter((event) => event.toolName === assertion.toolName).length;
      passed = count === 0;
      evidence = { count };
      explanation = passed
        ? `${assertion.toolName} was not called.`
        : `${assertion.toolName} crossed the prohibited boundary ${count} time${count === 1 ? "" : "s"}.`;
      break;
    }
    case "tool_order": {
      let cursor = -1;
      const positions: number[] = [];
      passed = assertion.toolNames.every((toolName) => {
        const next = calls.findIndex(
          (event, index) => index > cursor && event.toolName === toolName,
        );
        if (next < 0) return false;
        cursor = next;
        positions.push(next);
        return true;
      });
      evidence = { expected: assertion.toolNames, positions };
      explanation = passed
        ? `Observed required order: ${assertion.toolNames.join(" → ")}.`
        : `Missing required order: ${assertion.toolNames.join(" → ")}.`;
      break;
    }
    case "args_match": {
      const matchingCalls = calls.filter((event) => event.toolName === assertion.toolName);
      const selected = matchingCalls[assertion.occurrence - 1];
      passed = Boolean(
        selected?.args && deepPartialMatch(selected.args, assertion.expected),
      );
      evidence = {
        occurrence: assertion.occurrence,
        expected: assertion.expected,
        actual: selected?.args ?? null,
      };
      explanation = passed
        ? `${assertion.toolName} call ${assertion.occurrence} used the expected arguments.`
        : `${assertion.toolName} call ${assertion.occurrence} did not match the expected arguments.`;
      break;
    }
    case "state_equals": {
      const actual = getPath(finalState, assertion.path);
      passed = deepPartialMatch(actual, assertion.expected) && deepPartialMatch(assertion.expected, actual ?? null);
      evidence = { path: assertion.path, expected: assertion.expected, actual: actual ?? null };
      explanation = passed
        ? `Final state at ${assertion.path} matched the expected value.`
        : `Final state at ${assertion.path} was ${stableSerialize(actual ?? null)}, expected ${stableSerialize(assertion.expected)}.`;
      break;
    }
    case "max_calls": {
      const count = calls.filter((event) => event.toolName === assertion.toolName).length;
      passed = count <= assertion.max;
      evidence = { count, maximum: assertion.max };
      explanation = passed
        ? `${assertion.toolName} stayed within the ${assertion.max}-call limit.`
        : `${assertion.toolName} was called ${count} times, exceeding the ${assertion.max}-call limit.`;
      break;
    }
    case "final_response_contains": {
      const haystack = assertion.caseSensitive
        ? finalResponseText
        : finalResponseText.toLocaleLowerCase();
      const needle = assertion.caseSensitive
        ? assertion.text
        : assertion.text.toLocaleLowerCase();
      passed = haystack.includes(needle);
      evidence = { expectedText: assertion.text };
      explanation = passed
        ? `Final response included \"${assertion.text}\".`
        : `Final response did not include \"${assertion.text}\".`;
      break;
    }
  }

  return {
    assertionId: assertion.id,
    kind: assertion.kind,
    category: assertion.category,
    passed,
    explanation,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

export function evaluateAssertions(
  assertions: TraceAssertion[],
  trace: TraceEvent[] | NormalizedTraceEvent[],
  finalState: JsonObject,
  finalResponseText: string,
): AssertionResult[] {
  const normalized = normalizeTrace(
    trace.map((event) => ({ ...event, timestampMs: undefined })) as TraceEvent[],
  );
  return assertions.map((assertion) =>
    evaluateAssertion(assertion, normalized, finalState, finalResponseText),
  );
}

export class ActionExecutionError extends Error {
  constructor(
    public readonly code:
      | "INVALID_COLLECTION"
      | "INVALID_ARGUMENT"
      | "NOT_FOUND"
      | "VERSION_CONFLICT"
      | "INVALID_TRANSITION"
      | "CONFIRMATION_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "ActionExecutionError";
  }
}

export class IdempotencyGuard {
  readonly #claims = new Set<string>();

  claim(scope: string, key: string): boolean {
    const claim = `${scope}:${key}`;
    if (this.#claims.has(claim)) return false;
    this.#claims.add(claim);
    return true;
  }

  has(scope: string, key: string): boolean {
    return this.#claims.has(`${scope}:${key}`);
  }

  reset(): void {
    this.#claims.clear();
  }

  get size(): number {
    return this.#claims.size;
  }
}

export interface ApplySafeActionOptions {
  toolName?: string;
  confirmed?: boolean;
  idempotencyGuard?: IdempotencyGuard;
}

export interface SafeActionResult {
  nextState: JsonObject;
  output: JsonValue;
  changed: boolean;
  idempotentReplay: boolean;
}

function collectionFrom(state: JsonObject, name: string): JsonValue[] {
  const collection = state[name];
  if (!Array.isArray(collection)) {
    throw new ActionExecutionError(
      "INVALID_COLLECTION",
      `State collection \"${name}\" is not an array.`,
    );
  }
  return collection;
}

function objectItem(value: JsonValue, collection: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ActionExecutionError(
      "INVALID_COLLECTION",
      `Collection \"${collection}\" contains a non-object item.`,
    );
  }
  return value;
}

function requiredArgument(args: JsonObject, name: string): JsonValue {
  const value = args[name];
  if (value === undefined) {
    throw new ActionExecutionError(
      "INVALID_ARGUMENT",
      `Missing required action argument \"${name}\".`,
    );
  }
  return value;
}

function findById(collection: JsonValue[], id: JsonValue): number {
  return collection.findIndex((value) => {
    const item = objectItem(value, "unknown");
    return Object.is(item.id, id);
  });
}

function appendItem(
  action: AppendAction,
  args: JsonObject,
  collection: JsonValue[],
): JsonObject {
  const item: JsonObject = {};
  for (const [field, argument] of Object.entries(action.fields)) {
    item[field] = requiredArgument(args, argument);
  }
  item.id = `${action.idPrefix}-${String(collection.length + 1).padStart(3, "0")}`;
  if (action.idempotencyArgument) {
    item.idempotencyKey = requiredArgument(args, action.idempotencyArgument);
  }
  return item;
}

export function applySafeAction(
  state: JsonObject,
  action: SafeAction,
  args: JsonObject,
  options: ApplySafeActionOptions = {},
): SafeActionResult {
  if ("requireConfirmation" in action && action.requireConfirmation && !options.confirmed) {
    throw new ActionExecutionError(
      "CONFIRMATION_REQUIRED",
      `${options.toolName ?? action.kind} requires explicit human confirmation.`,
    );
  }

  const nextState = clone(state);
  const collection = collectionFrom(nextState, action.collection);

  if (action.kind === "query") {
    const matches = collection
      .filter((value) => {
        const item = objectItem(value, action.collection);
        return Object.entries(action.match).every(([field, argument]) => {
          const expected = requiredArgument(args, argument);
          const actual = item[field];
          if (typeof actual === "string" && typeof expected === "string") {
            return actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
          }
          return Object.is(actual, expected);
        });
      })
      .slice(0, action.limit);
    return { nextState, output: clone(matches), changed: false, idempotentReplay: false };
  }

  if (action.kind === "get") {
    const id = requiredArgument(args, action.idArgument);
    const index = findById(collection, id);
    if (index < 0) {
      throw new ActionExecutionError(
        "NOT_FOUND",
        `No item with id ${String(id)} exists in ${action.collection}.`,
      );
    }
    return {
      nextState,
      output: clone(collection[index]),
      changed: false,
      idempotentReplay: false,
    };
  }

  if (action.kind === "append") {
    let idempotencyKey: JsonValue | undefined;
    if (action.idempotencyArgument) {
      idempotencyKey = requiredArgument(args, action.idempotencyArgument);
      if (typeof idempotencyKey !== "string") {
        throw new ActionExecutionError(
          "INVALID_ARGUMENT",
          `Idempotency argument \"${action.idempotencyArgument}\" must be a string.`,
        );
      }
      const scope = options.toolName ?? `${action.kind}:${action.collection}`;
      const guard = options.idempotencyGuard;
      const existing = collection.find((value) => {
        const item = objectItem(value, action.collection);
        return item.idempotencyKey === idempotencyKey;
      });
      if (existing || (guard && !guard.claim(scope, idempotencyKey))) {
        return {
          nextState,
          output: clone(existing ?? { idempotencyKey, replayed: true }),
          changed: false,
          idempotentReplay: true,
        };
      }
    }
    const item = appendItem(action, args, collection);
    collection.push(item);
    return { nextState, output: clone(item), changed: true, idempotentReplay: false };
  }

  const id = requiredArgument(args, action.idArgument);
  const index = findById(collection, id);
  if (index < 0) {
    throw new ActionExecutionError(
      "NOT_FOUND",
      `No item with id ${String(id)} exists in ${action.collection}.`,
    );
  }
  const item = objectItem(collection[index], action.collection);

  if (action.kind === "patch") {
    if (action.versionArgument) {
      const expectedVersion = requiredArgument(args, action.versionArgument);
      if (!Object.is(item.version, expectedVersion)) {
        throw new ActionExecutionError(
          "VERSION_CONFLICT",
          `Expected version ${String(expectedVersion)}, found ${String(item.version)}.`,
        );
      }
    }
    for (const [field, argument] of Object.entries(action.fields)) {
      item[field] = requiredArgument(args, argument);
    }
    return { nextState, output: clone(item), changed: true, idempotentReplay: false };
  }

  const current = item[action.field];
  if (action.from !== undefined && !deepPartialMatch(current, action.from)) {
    throw new ActionExecutionError(
      "INVALID_TRANSITION",
      `Cannot transition ${action.field} from ${stableSerialize(current ?? null)}; expected ${stableSerialize(action.from)}.`,
    );
  }
  const target = action.toArgument
    ? requiredArgument(args, action.toArgument)
    : action.to;
  if (target === undefined) {
    throw new ActionExecutionError("INVALID_ARGUMENT", "Transition target is missing.");
  }
  item[action.field] = target;
  return { nextState, output: clone(item), changed: true, idempotentReplay: false };
}
