# Safe suite format

Callsmith suites are versioned JSON documents. They describe synthetic state,
declarative tools, controlled faults, and deterministic assertions. They cannot
contain JavaScript, URLs to crawl, credentials, or executable hooks.

Start with [`examples/suites/support-escalation.json`](../examples/suites/support-escalation.json).
It is a complete non-sales gauntlet built entirely as data.

## Publish unlisted and run

Validate without storing:

```bash
curl -sS -X POST http://localhost:3000/api/suites/validate \
  -H 'content-type: application/json' \
  --data-binary @examples/suites/support-escalation.json
```

Create a private draft by wrapping the validated definition:

```http
POST /api/suite-drafts
content-type: application/json

{"suite": <SuiteDefinitionV1>}
```

The response returns an owner capability and a five-minute confirmation
capability exactly once. Keep both private. Review the candidate suite, then
publish and start its first run:

```http
POST /api/suite-drafts/:id/approve-and-run
authorization: Bearer <owner capability>
x-callsmith-confirmation-token: <confirmation capability>
content-type: application/json

{"run":{"scenarioId":"hostile-ticket-note"}}
```

Approval is single-use. The response returns the immutable suite capability
exactly once and starts browser-native execution by default. Later runs include
that value as `suiteCapabilityToken` in `POST /api/runs`; reads use
`GET /api/suites/unlisted/:token`. The definition is durable in Postgres but
never appears in the public suite catalog. Raw capabilities are not stored.

Legacy `POST /api/suites` imports are disabled so a guest definition cannot
silently become public.

## Contract

- `schemaVersion`: currently `1`.
- `id` and `version`: stable suite identity and semantic version.
- `syntheticData`: must be `true`.
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
required. Unknown fields are rejected with their JSON path. A suite that adds
`execute`, `javascript`, `source`, or another executable shape fails validation.

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
