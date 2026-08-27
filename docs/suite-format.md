# Safe suite format

Callsmith suites are versioned JSON documents. They describe synthetic state,
declarative tools, controlled faults, and deterministic assertions. They cannot
contain JavaScript, URLs to crawl, credentials, or executable hooks.

New authoring uses `GuidedSuiteDraft`, which the server deterministically
compiles into `SuiteDefinitionV2`. Start with the checked-in guided examples:

- [`sales.json`](../tests/fixtures/guided-suite/sales.json)
- [`support.json`](../tests/fixtures/guided-suite/support.json)
- [`finance.json`](../tests/fixtures/guided-suite/finance.json)

The older [`support-escalation.json`](../examples/suites/support-escalation.json)
remains a readable V1 fixture and is migrated to V2 on read.

## Publish unlisted and run

Compile and validate a guided draft without storing it:

```bash
jq -n --slurpfile draft tests/fixtures/guided-suite/support.json \
  '{draft: $draft[0]}' | \
  curl -sS -X POST http://localhost:3000/api/suites/validate \
    -H 'content-type: application/json' \
    --data-binary @-
```

Create a private draft from the same guided input:

```http
POST /api/suite-drafts
content-type: application/json

{"draft": <GuidedSuiteDraft>}
```

For wire compatibility, both endpoints still accept an existing
`SuiteDefinitionV1`; it is returned as a migrated V2 definition.

The response returns an owner capability and a five-minute confirmation
capability exactly once. Keep both private. Review the candidate suite, then
publish and start its first run:

```http
POST /api/suite-drafts/:id/approve-and-run
authorization: Bearer <owner capability>
x-callsmith-confirmation-token: <confirmation capability>
content-type: application/json

{"run":{"scenarioId":"safety-boundary"}}
```

Approval is single-use. The response returns the immutable suite capability
exactly once and starts browser-native execution by default. Later runs include
that value as `suiteCapabilityToken` in `POST /api/runs`; reads use
`GET /api/suites/unlisted/:token`. The definition is durable in Postgres but
never appears in the public suite catalog. Raw capabilities are not stored.

Legacy `POST /api/suites` imports are disabled so a guest definition cannot
silently become public.

## Guided authoring contract

`GuidedSuiteDraft` contains only bounded JSON:

- stable suite identity, title, domain, goal, and seed;
- synthetic initial state;
- at least one read tool and one mutation tool using the safe action DSL;
- a fault profile whose hostile content targets the declared untrusted read;
- contract metadata naming the consequential mutation, every confirmation and
  idempotency target, and the protected state path with safe/unsafe values; and
- safe and unsafe expected call sequences plus their exact final states.

Both expected sequences must exercise the untrusted read and every confirmation
boundary. The compiler executes the declared actions against cloned synthetic
state. It rejects a claimed final state unless it exactly matches the simulated
result. It then derives task, trajectory, safety, and recovery assertions plus
deterministic baseline walkthroughs.

The draft limit is 256 KB. Executable/code-like content, external URLs,
credential-shaped fields, reserved prototype keys, unknown collections,
invalid state paths, inconsistent guards, and undeclared side effects are
rejected with stable issue codes and JSON paths.

## Compiled suite contract

- `schemaVersion`: `2` for newly compiled suites; V1 remains readable.
- `id` and `version`: stable suite identity and semantic version.
- `syntheticData`: must be `true`.
- `contractDesign`: trust source, consequential mutation, protected state,
  confirmation targets, and idempotency targets.
- `tools`: strict JSON Schemas, annotations, and one safe action.
- `scenarios`: goal, seeded state, enabled tools, faults, assertions, and
  deterministic success/failure walkthroughs.

The only action kinds are:

- `query`: filter a top-level synthetic collection.
- `get`: read one item by ID.
- `patch`: update declared fields, optionally with a version guard.
- `append`: add one item, optionally with an idempotency key.
- `transition`: move one declared field between allowed states.

Every action argument must exist in the tool's strict input schema and be
required. Every action collection must be a top-level array in the synthetic
state. Unknown fields are rejected with their JSON path.

## Safety evaluation

For the signature safety case, Callsmith runs the same model, task, seed, and
hostile content against two generated website contracts:

- `weak`: trust and idempotency hints are removed and consequential actions are
  inadequately protected.
- `hardened`: untrusted content is annotated, idempotency is explicit, and the
  browser tool blocks consequential state changes pending human confirmation.

The official `webmcp-evals@0.0.3` expected-call result is retained as the
baseline. Callsmith separately evaluates task completion, unsafe attempts,
actual state mutation, and prevented harm.
