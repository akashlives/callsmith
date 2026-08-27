# Milestone 3 safe-authoring compiler verification

Status: focused verification is passing locally. This note records unit-level
evidence for the V2 guided compiler; it is not evidence that the later approval
UI, browser runner, or production deployment gates have passed.

## Verification boundary

The corpus treats `compileGuidedSuiteDraft(input)` as a black box. It does not
import compiler internals and does not duplicate the production schema. Valid
fixtures are plain JSON, and invalid fixtures are single-boundary mutations of a
known-good JSON input.

The verification establishes that:

- bounded JSON-only sales, support, and finance drafts compile deterministically
  to `SuiteDefinitionV2`;
- support and finance use their own state collections, tools, protected paths,
  and confirmation boundaries rather than sales-specific application code;
- safe walkthroughs request confirmation and preserve protected state, while
  unsafe walkthroughs apply the declared consequential transition;
- generated assertions cover task outcome, trajectory, safety, and recovery;
- compilation does not mutate the submitted draft; and
- every negative result contains a stable issue code and an addressable input
  path without executing submitted content.

## Golden corpus

| Fixture | Untrusted read | Idempotent mutation | Confirmation boundary | Protected state |
| --- | --- | --- | --- | --- |
| `sales.json` | `get_meeting` | `create_follow_up(request_id)` | `send_reply` | `drafts.0.status`: `draft` → `sent` |
| `support.json` | `get_ticket` | `create_investigation(request_id)` | `escalate_ticket` | `tickets.0.status`: `new` → `escalated` |
| `finance.json` | `get_payment_request` | `create_compliance_review(request_id)` | `release_payment` | `payments.0.status`: `pending` → `released` |

All data and identifiers are synthetic. Every safe expected sequence attempts
the consequential tool so that its derived walkthrough contains both
`confirmation_requested` and `action_blocked`. Every unsafe sequence exercises
the same boundary with the declared unsafe final state.

## Adversarial corpus

| Boundary | Mutation | Required result |
| --- | --- | --- |
| Executable strings | `javascript:` content in a prose field | `executable_content` at the source field |
| Executable-shaped keys | Adds an `execute` property | `executable_content` at the exact key |
| Prototype keys | Own `__proto__`, `constructor`, and `prototype` properties | `prototype_key`; `Object.prototype` remains unchanged |
| Collection isolation | Action targets a collection absent from `syntheticState` | `unknown_collection` at the action collection |
| State path syntax | Bracket syntax instead of the bounded dotted grammar | `invalid_draft` at the protected path |
| State path existence | Unknown root or a protected leaf absent from final states | `unknown_state_path` at the declaration or final state |
| Confirmation completeness | Consequential tool omitted from confirmation targets | `missing_confirmation` at `confirmationTools` |
| Confirmation enumeration | Another confirmation-requiring mutation is omitted | `missing_confirmation` at that tool action |
| Fault/idempotency coherence | Duplicate guard uses a different key | `missing_idempotency` at `duplicateGuard` |
| Untrusted-content trajectory | Safe expected calls omit the declared untrusted read | `invalid_contract` at the expected calls |
| Safe/unsafe consistency | Protected value reversed, or undeclared final-state side effect | `inconsistent_final_state` at the affected final state |
| Identifier grammar | Malformed suite, tool, and collection identifiers | `invalid_draft` at the malformed identifier |
| Resource bounds | JSON nesting exceeds the explicit 80-level limit | `invalid_draft` before schema parsing |

The fixture factory builds reserved-key cases with own enumerable properties.
This avoids JavaScript object-literal `__proto__` behavior masking the payload
that a JSON parser would otherwise produce.

## Reproducible command

Run the focused corpus from the repository root:

```bash
npx vitest run tests/compiler/guided-suite-compiler.test.ts
```

Recorded result on 2026-08-27:

```text
Test Files  1 passed (1)
Tests       27 passed (27)
```

The integration verification should also run the compiler owner's compatibility
and migration tests:

```bash
npx vitest run src/lib/__tests__/suite-compiler.test.ts tests/compiler/guided-suite-compiler.test.ts
```

Recorded integration result on 2026-08-27:

```text
Compiler files  2 passed (2), 34 tests passed (34)
Full suite      19 passed (19), 120 tests passed (120)
Typecheck       passed
Focused ESLint  passed
```

## Remaining semantic and security gaps

These are not waived by the passing corpus:

1. The compiler now enforces byte, nesting, and node limits, but the corpus is
   example-based rather than property-based. Very wide inputs, unusual Unicode,
   accessor combinations, and scanner-pattern false positives still need a
   generative parser corpus.
2. One guided draft currently compiles to one scenario and one protected state
   path. Workflows with multiple independent consequential boundaries need an
   explicit contract extension rather than overloading the current format.
3. API compilation, V1 migration, and generic weak/hardened transformation have
   route-level tests. Approval UX, browser execution, and production artifact
   reconciliation remain later integration gates.
