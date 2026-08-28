# Callsmith architecture

## Product invariant

A safety verdict is impossible without two completed browser-native attempts
that share the model, prompt, seed, and compiled safety contract. Only the
website contract variant changes.

```text
SafetyContractDraftV1
        |
 deterministic compiler
        |
   immutable contract
        |
 Postgres experiment + outbox
        |
 Redis Stream consumer group
       / \
    weak  hardened
       \ /
 complete matched pair
        |
 EvidenceReceiptV1 + SHA-256
```

## Web service

Next.js owns contract validation, human review, experiment status, Redis-backed
SSE, immutable receipt reads, the narrative UI, and isolated sandbox pages. It
does not call a model provider directly.

Postgres is the synchronous source of truth for:

- immutable compiled contracts;
- proposals and their independent capabilities;
- experiments;
- unique attempts keyed by experiment, model, seed, and contract;
- immutable receipts;
- the transactional experiment outbox.

Raw capabilities never enter a table.

## Worker

The worker consumes `callsmith:experiment-jobs:v1` through a Redis Streams
consumer group. It renews its lease during long browser work, claims stale
messages after a crash, skips already completed variants, and acknowledges only
after terminal evidence is preserved.

The worker uses one narrow adapter around `webmcp-evals` 0.0.4. Chrome opens
the real sandbox, discovers native `page.webmcp` tools, invokes them, and
returns browser-originated evidence envelopes. The adapter records runner,
browser, backend, trace, console failures, and official expected-call results.

A Postgres outbox closes the database-to-Redis gap. The worker polls undispatched
experiments and can redeliver safely because attempt identity is unique.

## Human boundary

`propose_safety_contract` validates and persists a proposal, opens a local
review panel, and returns immediately with a read-only status capability.
Decision and owner capabilities remain in the browser closure.

The review shows hostile content, protected state, generated prompt, expected
calls, and contract difference. Its declarative WebMCP form deliberately omits
`toolautosubmit`. Approval publishes the immutable contract and starts one
experiment; rejection starts none.

## Receipt immutability

The receipt contains facts, not a weighted score. Postgres triggers reject
updates or deletes to receipts and reject attempt or experiment mutations after
finalization. Identical receipt payloads are idempotent. Every response uses
immutable caching and an ETag derived from the content hash.

## Deployment

Web and worker use the same Docker image and Git-derived Next.js deployment ID.
Railway runs them as separate services connected through private networking to
Postgres and Redis. Readiness requires database, queue, and recent worker
heartbeat; liveness only confirms process health.
