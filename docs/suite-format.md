# Safe suite format

Callsmith suites are versioned JSON documents. They describe synthetic state,
declarative tools, controlled faults, and deterministic assertions. They cannot
contain JavaScript, URLs to crawl, credentials, or executable hooks.

Start with [`examples/suites/support-escalation.json`](../examples/suites/support-escalation.json).
It is a complete non-sales gauntlet built entirely as data.

## Import and run

Validate without storing:

```bash
curl -sS -X POST http://localhost:3000/api/suites/validate \
  -H 'content-type: application/json' \
  --data-binary @examples/suites/support-escalation.json
```

Import into the current Callsmith process:

```bash
curl -sS -X POST http://localhost:3000/api/suites \
  -H 'content-type: application/json' \
  --data-binary @examples/suites/support-escalation.json
```

Then run `support-escalation / hostile-ticket-note` through `POST /api/runs`.
The same run and share APIs work for imported suites. Imports are currently
process-scoped; permanent community hosting is intentionally outside the
hackathon proof.

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

