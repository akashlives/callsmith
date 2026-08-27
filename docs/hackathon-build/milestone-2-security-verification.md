# Milestone 2 security verification

This gate covers guest-authored suite confidentiality, authorization,
durability, and immutability. It treats every suite, draft, and capability token
as untrusted input and verifies behavior through the same repository and route
boundaries used by the application.

## Security invariants

- Guest suites never appear in the built-in public suite catalog.
- The legacy public import endpoint is retired and points callers to the
  capability-protected draft workflow; it cannot publish into the catalog.
- Draft reads require the matching owner capability. Missing and incorrect
  owner tokens do not reveal whether a draft exists.
- Publishing requires both the owner capability and the short-lived,
  single-use confirmation capability.
- Published suites are readable and runnable only with their opaque suite
  capability token.
- Raw owner, confirmation, and suite capability tokens are never persisted;
  only cryptographic hashes cross the repository boundary.
- Publication is one-way. A published `(suite id, version)` cannot be replaced,
  and all returned definitions are defensive copies.
- Drafts and published suites remain resolvable after a repository instance is
  discarded and recreated over the same durable backend.

## Adversarial matrix

| Boundary | Valid path | Missing or malformed capability | Wrong capability | Expired or reused capability |
| --- | --- | --- | --- | --- |
| Draft read | Owner token returns the draft | Generic not-found response | Generic not-found response | N/A |
| Draft approval | Owner + confirmation publishes once | Approval is rejected | Approval is rejected without publication | Expired confirmation is gone; reused confirmation conflicts |
| Unlisted suite read | Suite token returns an immutable clone | Generic not-found response | Generic not-found response | Suite capability is durable; confirmation expiry does not revoke it |
| Run creation | Suite token resolves the private suite | Private suite remains undiscoverable | No run is created | N/A |
| Public catalog | Built-in suites only | N/A | N/A | N/A |

## Automated evidence

The Milestone 2 tests cover:

1. Repository re-instantiation over one backend before and after publication.
2. Token hashing and the absence of raw capabilities in stored records.
3. Defensive-copy behavior and `(suite id, version)` publication conflicts.
4. Missing, wrong, expired, and reused approval capabilities.
5. Missing and wrong owner capabilities with non-enumerating responses.
6. Unlisted read and run authorization with catalog non-disclosure.
7. Rejection of the legacy public-import bypass.
8. Preservation of the approved suite across a simulated application restart.

Run the focused gate with:

```bash
npx vitest run tests/security/guest-suite-repository.test.ts tests/api/guest-suite-security.test.ts
```

## Deployed restart evidence

- Railway staging deployments `8bb5e1fb-05f1-4712-992b-2184353c2fcd`
  (`web`) and `1b3e9b9a-56f7-4d52-99e0-69ca25e7ac22` (`runner`)
  published the registry against the real staging Postgres and Redis services.
- The unlisted `m2-support-1787813274761@1.0.0` suite was published with a
  short-lived, single-use approval. Missing/wrong owner, suite, and run
  capabilities returned non-enumerating `404` responses; approval reuse
  returned `409`; the suite never appeared in the REST or WebMCP catalog.
- Both staging services were then replaced by redeployments
  `6e528168-28b7-434d-a4d5-e4a96a075d4a` (`web`) and
  `66c1ed42-1c25-4c47-802f-c5c50d2269a4` (`runner`). The same suite capability
  still resolved afterward and created run
  `run-fe8ecac8-2629-45f8-9c41-f8e76ba805bb`, which completed with two
  deterministic-preview attempts.
- Browser-native run `run-bf3fd461-09bd-4b5c-90ed-14a5a02d5436` was queued
  before the restart, recovered from Redis, and completed afterward with one
  weak and one hardened attempt from Chrome 154 dev through
  `webmcp-evals@0.0.3`.
- A scan of the authorized suite response, recovered run, and shared report
  found no raw owner, confirmation, suite, worker-access, or token-hash fields.
- Browser Use QA verified REST/WebMCP catalog isolation and run status in
  ChatGPT's in-app browser. Chrome rendered the same read-only report without
  overflow. The connected Chrome profile still lacks the WebMCP capability;
  its manual discovery gate remains assigned to Milestone 8, while the worker's
  browser-originated evidence records Chrome 154 dev provenance.
- Production deployments `954cb401-ad4a-42d9-bfe1-a99053c59ebd` (`web`) and
  `3a42abe7-cb5b-4b97-9860-f10fc021ed7c` (`runner`) succeeded. The production
  health endpoint, built-in-only catalog, retired import response, both
  canonical reports, in-app Browser report, and Chrome homepage smoke checks
  passed after promotion.
- Final web deployments `43384610-7f33-47bf-a0d0-2d9c4a5b5fb7` (staging) and
  `cb7b7c58-0c53-441a-a9d5-a85e4b1f5b77` (production) moved the 256 KB suite
  bound ahead of draft persistence. Deployed HTTP checks returned `422` for an
  oversized definition without entering the repository workflow.

## Gate result

- `npm run lint`, `npm run typecheck`, all 82 Vitest tests, and the Next.js
  production build pass.
- Ten desktop/mobile Playwright story flows pass serially. The original
  parallel pass exposed cold development compilation exceeding old five-second
  UI assertions; those waits now use the product's 30-second evidence contract.
- Real expiry behavior is covered by an injected-clock repository/API test; the
  deployed confirmation challenge was not kept open for five minutes solely to
  duplicate that deterministic check.
