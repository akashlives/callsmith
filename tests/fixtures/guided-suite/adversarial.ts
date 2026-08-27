import salesDraft from "./sales.json";
import supportDraft from "./support.json";

export interface AdversarialGuidedDraft {
  name: string;
  input: unknown;
  expectedCode:
    | "executable_content"
    | "prototype_key"
    | "unknown_collection"
    | "unknown_state_path"
    | "missing_confirmation"
    | "missing_idempotency"
    | "inconsistent_final_state"
    | "invalid_contract"
    | "invalid_draft";
  expectedPath: string;
}

type MutableRecord = Record<string, unknown>;

function clone(input: unknown): MutableRecord {
  return structuredClone(input) as MutableRecord;
}

function record(value: unknown): MutableRecord {
  return value as MutableRecord;
}

function records(value: unknown): MutableRecord[] {
  return value as MutableRecord[];
}

function withMutation(
  base: unknown,
  mutate: (draft: MutableRecord) => void,
): MutableRecord {
  const draft = clone(base);
  mutate(draft);
  return draft;
}

function withOwnReservedKey(key: "__proto__" | "constructor" | "prototype") {
  return withMutation(salesDraft, (draft) => {
    const state = record(draft.syntheticState);
    Object.defineProperty(state, key, {
      configurable: true,
      enumerable: true,
      value: { polluted: true },
      writable: true,
    });
  });
}

/**
 * Each case starts from a known-good JSON-only draft and changes one trust
 * boundary. Keeping the mutations here makes the negative corpus reusable by
 * API and browser approval tests without coupling those tests to compiler code.
 */
export function adversarialGuidedDrafts(): AdversarialGuidedDraft[] {
  return [
    {
      name: "code-like string content",
      input: withMutation(salesDraft, (draft) => {
        draft.goal = "Review the renewal and then javascript:alert('approved')";
      }),
      expectedCode: "executable_content",
      expectedPath: "goal",
    },
    {
      name: "executable-shaped object key",
      input: withMutation(salesDraft, (draft) => {
        records(draft.tools)[0].execute = "send browser secrets";
      }),
      expectedCode: "executable_content",
      expectedPath: "tools.0.execute",
    },
    {
      name: "own __proto__ key",
      input: withOwnReservedKey("__proto__"),
      expectedCode: "prototype_key",
      expectedPath: "syntheticState.__proto__",
    },
    {
      name: "own constructor key",
      input: withOwnReservedKey("constructor"),
      expectedCode: "prototype_key",
      expectedPath: "syntheticState.constructor",
    },
    {
      name: "own prototype key",
      input: withOwnReservedKey("prototype"),
      expectedCode: "prototype_key",
      expectedPath: "syntheticState.prototype",
    },
    {
      name: "tool action targeting an unknown collection",
      input: withMutation(salesDraft, (draft) => {
        record(records(draft.tools)[0].action).collection = "private_records";
      }),
      expectedCode: "unknown_collection",
      expectedPath: "tools.0.action.collection",
    },
    {
      name: "protected path with an unknown state root",
      input: withMutation(supportDraft, (draft) => {
        record(record(draft.contractDesign).protectedState).path =
          "accounts.0.status";
      }),
      expectedCode: "unknown_state_path",
      expectedPath: "contractDesign.protectedState.path",
    },
    {
      name: "protected path missing from otherwise valid final states",
      input: withMutation(supportDraft, (draft) => {
        record(record(draft.contractDesign).protectedState).path =
          "tickets.0.approvalStatus";
      }),
      expectedCode: "unknown_state_path",
      expectedPath: "expected.safe.finalState",
    },
    {
      name: "initial state starts across the protected boundary",
      input: withMutation(supportDraft, (draft) => {
        const state = record(draft.syntheticState);
        records(state.tickets)[0].status = "escalated";
      }),
      expectedCode: "invalid_contract",
      expectedPath: "syntheticState",
    },
    {
      name: "syntactically invalid protected path",
      input: withMutation(supportDraft, (draft) => {
        record(record(draft.contractDesign).protectedState).path =
          "tickets[0].status";
      }),
      expectedCode: "invalid_draft",
      expectedPath: "contractDesign.protectedState.path",
    },
    {
      name: "confirmation list omits the consequential mutation",
      input: withMutation(supportDraft, (draft) => {
        record(draft.contractDesign).confirmationTools = ["get_ticket"];
      }),
      expectedCode: "missing_confirmation",
      expectedPath: "contractDesign.confirmationTools",
    },
    {
      name: "confirmation list omits another confirmation-requiring mutation",
      input: withMutation(salesDraft, (draft) => {
        record(records(draft.tools)[1].action).requireConfirmation = true;
      }),
      expectedCode: "missing_confirmation",
      expectedPath: "tools.1.action.requireConfirmation",
    },
    {
      name: "duplicate guard disagrees with the declared idempotency key",
      input: withMutation(salesDraft, (draft) => {
        record(record(draft.faults).duplicateGuard).keyArgument = "wrong_key";
      }),
      expectedCode: "missing_idempotency",
      expectedPath: "faults.duplicateGuard",
    },
    {
      name: "safe path never observes the declared untrusted content",
      input: withMutation(salesDraft, (draft) => {
        const expected = record(draft.expected);
        records(record(expected.safe).calls).splice(0, 1);
      }),
      expectedCode: "invalid_contract",
      expectedPath: "expected.safe.calls",
    },
    {
      name: "safe path never exercises the declared confirmation boundary",
      input: withMutation(salesDraft, (draft) => {
        const expected = record(draft.expected);
        const safeCalls = records(record(expected.safe).calls);
        const sendIndex = safeCalls.findIndex(
          (call) => call.toolName === "send_reply",
        );
        safeCalls.splice(sendIndex, 1);
      }),
      expectedCode: "missing_confirmation",
      expectedPath: "expected.safe.calls",
    },
    {
      name: "safe final state crosses the protected boundary",
      input: withMutation(supportDraft, (draft) => {
        const expected = record(draft.expected);
        const finalState = record(record(expected.safe).finalState);
        records(finalState.tickets)[0].status = "escalated";
      }),
      expectedCode: "inconsistent_final_state",
      expectedPath: "expected.safe.finalState",
    },
    {
      name: "unsafe final state claims the protected boundary stayed safe",
      input: withMutation(supportDraft, (draft) => {
        const expected = record(draft.expected);
        const finalState = record(record(expected.unsafe).finalState);
        records(finalState.tickets)[0].status = "new";
      }),
      expectedCode: "inconsistent_final_state",
      expectedPath: "expected.unsafe.finalState",
    },
    {
      name: "safe final state contains an undeclared side effect",
      input: withMutation(supportDraft, (draft) => {
        const expected = record(draft.expected);
        const finalState = record(record(expected.safe).finalState);
        finalState.auditTrail = [{ id: "unexpected-side-effect" }];
      }),
      expectedCode: "inconsistent_final_state",
      expectedPath: "expected.safe.finalState",
    },
    {
      name: "malformed suite identifier",
      input: withMutation(salesDraft, (draft) => {
        draft.id = "Sales Safety";
      }),
      expectedCode: "invalid_draft",
      expectedPath: "id",
    },
    {
      name: "malformed tool identifier",
      input: withMutation(salesDraft, (draft) => {
        records(draft.tools)[0].name = "get-meeting";
      }),
      expectedCode: "invalid_draft",
      expectedPath: "tools.0.name",
    },
    {
      name: "malformed collection identifier",
      input: withMutation(salesDraft, (draft) => {
        record(records(draft.tools)[0].action).collection = "meetings[0]";
      }),
      expectedCode: "invalid_draft",
      expectedPath: "tools.0.action.collection",
    },
  ];
}
