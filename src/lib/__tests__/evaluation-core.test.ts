import { describe, expect, it } from "vitest";

import type {
  JsonObject,
  SafeAction,
  TraceAssertion,
  TraceEvent,
} from "@/lib/contracts";
import {
  ActionExecutionError,
  IdempotencyGuard,
  applySafeAction,
  evaluateAssertions,
  normalizeTrace,
  redactSecrets,
} from "@/lib/evaluation";

const state: JsonObject = {
  records: [
    { id: "one", name: "Northstar Health", status: "draft", version: 2 },
    { id: "two", name: "Other", status: "draft", version: 1 },
  ],
  items: [],
};

describe("deterministic trace assertions", () => {
  const trace: TraceEvent[] = [
    {
      sequence: 2,
      type: "tool_call",
      toolName: "mutate_record",
      args: { record_id: "one", api_key: "must-redact" },
      output: { nested: [{ password: "must-redact" }] },
      stateBefore: { records: [] },
      stateAfter: { records: [{ id: "one" }] },
      faultType: "prompt_injection",
      message: "mutation attempted",
      metadata: { authorization: "must-redact" },
    },
    {
      sequence: 0,
      type: "tool_call",
      toolName: "read_record",
      args: { record_id: "one" },
    },
    { sequence: 3, type: "final_response", message: "Waiting for human approval." },
  ];

  it("normalizes every evidence field and redacts nested secrets", () => {
    const normalized = normalizeTrace(trace);
    expect(normalized.map((event) => event.toolName)).toEqual([
      "read_record",
      "mutate_record",
      undefined,
    ]);
    expect(normalized[1]).toMatchObject({
      id: "event-002",
      sequence: 1,
      args: { api_key: "[REDACTED]", record_id: "one" },
      output: { nested: [{ password: "[REDACTED]" }] },
      metadata: { authorization: "[REDACTED]" },
    });
    expect(
      redactSecrets([{ safe: true, refresh_token: "hidden" }, null]),
    ).toEqual([{ refresh_token: "[REDACTED]", safe: true }, null]);
  });

  it("evaluates every supported temporal and state assertion", () => {
    const assertions: TraceAssertion[] = [
      { id: "called", description: "called", category: "taskOutcome", kind: "tool_called", toolName: "read_record", atLeast: 1 },
      { id: "not_called", description: "not called", category: "safety", kind: "tool_not_called", toolName: "delete_record" },
      { id: "ordered", description: "ordered", category: "trajectory", kind: "tool_order", toolNames: ["read_record", "mutate_record"] },
      { id: "args", description: "args", category: "trajectory", kind: "args_match", toolName: "read_record", expected: { record_id: "one" }, occurrence: 1 },
      { id: "state", description: "state", category: "safety", kind: "state_equals", path: "records.0.status", expected: "draft" },
      { id: "maximum", description: "maximum", category: "recovery", kind: "max_calls", toolName: "mutate_record", max: 1 },
      { id: "response", description: "response", category: "taskOutcome", kind: "final_response_contains", text: "human approval", caseSensitive: false },
    ];
    expect(
      evaluateAssertions(assertions, trace, state, "Waiting for HUMAN APPROVAL."),
    ).toHaveLength(7);
    expect(
      evaluateAssertions(assertions, trace, state, "Waiting for HUMAN APPROVAL.")
        .every((result) => result.passed),
    ).toBe(true);

    const failingTrace: TraceEvent[] = [
      { sequence: 0, type: "tool_call", toolName: "delete_record", args: {} },
      { sequence: 1, type: "tool_call", toolName: "mutate_record", args: {} },
      { sequence: 2, type: "tool_call", toolName: "mutate_record", args: {} },
    ];
    const failures = evaluateAssertions(
      assertions,
      failingTrace,
      { records: [{ status: "sent" }] },
      "Done",
    );
    expect(failures.every((result) => !result.passed)).toBe(true);
  });
});

describe("safe JSON action engine", () => {
  it("queries strings and primitives and gets a record without mutating input", () => {
    const query = applySafeAction(
      state,
      {
        kind: "query",
        collection: "records",
        match: { name: "needle", status: "expected_status" },
        limit: 2,
        requireConfirmation: false,
      },
      { needle: "northstar", expected_status: "draft" },
    );
    expect(query.output).toMatchObject([{ id: "one" }]);
    expect(query.changed).toBe(false);
    const get = applySafeAction(
      state,
      { kind: "get", collection: "records", idArgument: "record_id", requireConfirmation: false },
      { record_id: "two" },
    );
    expect(get.output).toMatchObject({ id: "two" });
    expect(state.records).toEqual([
      { id: "one", name: "Northstar Health", status: "draft", version: 2 },
      { id: "two", name: "Other", status: "draft", version: 1 },
    ]);
  });

  it("appends once for an idempotency key and identifies replays", () => {
    const action: SafeAction = {
      kind: "append",
      collection: "items",
      fields: { title: "title" },
      idPrefix: "item",
      idempotencyArgument: "request_id",
      requireConfirmation: false,
    };
    const guard = new IdempotencyGuard();
    const first = applySafeAction(
      state,
      action,
      { title: "Follow up", request_id: "request-one" },
      { toolName: "create_item", idempotencyGuard: guard },
    );
    expect(first).toMatchObject({ changed: true, idempotentReplay: false });
    expect(guard.has("create_item", "request-one")).toBe(true);
    expect(guard.size).toBe(1);
    const replay = applySafeAction(
      first.nextState,
      action,
      { title: "Follow up", request_id: "request-one" },
      { toolName: "create_item", idempotencyGuard: guard },
    );
    expect(replay).toMatchObject({ changed: false, idempotentReplay: true });
    guard.reset();
    expect(guard.size).toBe(0);
    guard.claim("create_item", "preclaimed");
    const guardedReplay = applySafeAction(
      state,
      action,
      { title: "Follow up", request_id: "preclaimed" },
      { toolName: "create_item", idempotencyGuard: guard },
    );
    expect(guardedReplay.output).toEqual({
      idempotencyKey: "preclaimed",
      replayed: true,
    });
  });

  it("patches with optimistic concurrency and performs declared transitions", () => {
    const patched = applySafeAction(
      state,
      {
        kind: "patch",
        collection: "records",
        idArgument: "record_id",
        fields: { status: "next_status" },
        versionArgument: "expected_version",
        requireConfirmation: false,
      },
      { record_id: "one", next_status: "review", expected_version: 2 },
    );
    expect(patched.output).toMatchObject({ status: "review" });
    const transitioned = applySafeAction(
      patched.nextState,
      {
        kind: "transition",
        collection: "records",
        idArgument: "record_id",
        field: "status",
        from: "review",
        toArgument: "target",
        requireConfirmation: false,
      },
      { record_id: "one", target: "sent" },
    );
    expect(transitioned.output).toMatchObject({ status: "sent" });
  });

  it("fails closed for invalid collections, arguments, versions, transitions, and confirmation", () => {
    const get: SafeAction = {
      kind: "get",
      collection: "records",
      idArgument: "record_id",
      requireConfirmation: false,
    };
    expect(() => applySafeAction({ records: "wrong" }, get, { record_id: "one" })).toThrow(/not an array/i);
    expect(() => applySafeAction({ records: ["wrong"] }, get, { record_id: "one" })).toThrow(/non-object/i);
    expect(() => applySafeAction(state, get, {})).toThrow(/missing required/i);
    expect(() => applySafeAction(state, get, { record_id: "missing" })).toThrow(/no item/i);
    try {
      applySafeAction(
        state,
        {
          kind: "transition",
          collection: "records",
          idArgument: "record_id",
          field: "status",
          from: "draft",
          to: "sent",
          requireConfirmation: true,
        },
        { record_id: "one" },
        { toolName: "protected_transition" },
      );
      throw new Error("Expected confirmation to fail closed");
    } catch (error) {
      expect(error).toBeInstanceOf(ActionExecutionError);
      expect((error as ActionExecutionError).code).toBe("CONFIRMATION_REQUIRED");
    }
    expect(() => applySafeAction(
      state,
      {
        kind: "append",
        collection: "items",
        fields: { title: "title" },
        idPrefix: "item",
        idempotencyArgument: "request_id",
        requireConfirmation: false,
      },
      { title: "x", request_id: 2 },
    )).toThrow(/must be a string/i);
    expect(() => applySafeAction(
      state,
      {
        kind: "patch",
        collection: "records",
        idArgument: "record_id",
        fields: { status: "next_status" },
        versionArgument: "expected_version",
        requireConfirmation: false,
      },
      { record_id: "one", next_status: "review", expected_version: 1 },
    )).toThrow(/expected version/i);
    expect(() => applySafeAction(
      state,
      {
        kind: "transition",
        collection: "records",
        idArgument: "record_id",
        field: "status",
        from: "review",
        to: "sent",
        requireConfirmation: false,
      },
      { record_id: "one" },
    )).toThrow(/cannot transition/i);
    expect(() => applySafeAction(
      state,
      {
        kind: "patch",
        collection: "records",
        idArgument: "record_id",
        fields: { status: "next_status" },
        requireConfirmation: false,
      },
      { record_id: "missing", next_status: "review" },
    )).toThrow(/no item/i);
    expect(() => applySafeAction(
      { records: [{ id: "one", status: { nested: ["draft"] } }] },
      {
        kind: "transition",
        collection: "records",
        idArgument: "record_id",
        field: "status",
        from: { nested: ["review"] },
        to: "sent",
        requireConfirmation: false,
      },
      { record_id: "one" },
    )).toThrow(/cannot transition/i);
  });
});
