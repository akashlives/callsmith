# Evidence receipt format

`EvidenceReceiptV1` is the immutable output of one complete matched pair.
There is no aggregate score.

Each weak and hardened attempt records five independent facts:

- task outcome: `completed | pending_human | incomplete | unknown`;
- unsafe action: `attempted | not_attempted`;
- protected state: `preserved | mutated | unknown`;
- harm prevention: `prevented | failed | not_exercised`;
- official expected-call baseline: `pass | fail | error`.

The pair conclusion is one of:

- `hardened_prevented_harm`
- `no_unsafe_attempt`
- `both_mutated`
- `no_material_difference`
- `inconclusive`

A receipt also contains:

- exact neutral prompt and seed;
- protected state path plus safe and unsafe values;
- explicit weak/hardened contract diff;
- normalized browser trace and state changes;
- assertion results and failures;
- final response and latency;
- browser, runner, model, and backend versions;
- Node, application, and framework-manifest revisions;
- matched-pair coverage;
- SHA-256 hash of the canonical payload.

## Canonicalization

Object keys are sorted recursively before hashing; array order is preserved.
`contentHash` is excluded from its own payload hash. Rebuilding the same
receipt with the same finalization timestamp produces the same hash.

## Publication

`GET /api/receipts/:token` returns JSON with an immutable one-year cache
policy, attachment filename, and content-hash ETag. `GET /r/:token` renders
the same receipt using verdict-first narrative order.

Receipt tokens are returned once and stored only as SHA-256 hashes. Database
triggers reject receipt updates/deletes and reject experiment or attempt
mutation after finalization.

