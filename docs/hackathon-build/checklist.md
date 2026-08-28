# Callsmith safety-contract reset checklist

Build mode: autonomous implementation with a participant review pause after
every three verified capabilities. Production promotion remains gated by real
browser-use QA in ChatGPT's in-app browser and WebMCP-enabled Chrome.

The product claim is deliberately narrow:

> Callsmith proves whether a website contract allowed an unsafe state
> transition and whether the hardened website prevented harm.

- [ ] **1. Establish the clean truth model**
  What to build: Replace public suite/run/score semantics with a compact
  `SafetyContractDraftV1`, matched weak/hardened experiments, and immutable
  `EvidenceReceiptV1` facts. Convert the canonical meeting-note case and remove
  sales-specific inference, V1 migration, preview, simulation, BYOK, model
  comparison, and obsolete exports.
  Acceptance: The same model, task, and seed are used for both contracts; no
  score or incomplete pair can masquerade as a safety result.
  Verify: Compiler, receipt, security, and migration-removal tests pass;
  dependency analysis finds no active legacy path.

- [ ] **2. Run on the current browser-native engine**
  What to build: Move to Node 24 LTS and `webmcp-evals@0.0.4`, remove the local
  package patch, use the official browser/smoke interface through one adapter,
  capture native WebMCP discovery and browser-console evidence, and derive all
  runtime versions dynamically.
  Acceptance: Official smoke mode invokes both contracts without a model key;
  one live Luna pair proves weak mutation and hardened prevention.
  Verify: Runner contract tests, local smoke, and a ten-pair latency canary pass.

- [ ] **3. Make the Railway experiment path durable**
  What to build: Make Postgres authoritative for proposals, experiments,
  attempts, and receipts; use Redis Streams with acknowledgment/reclaim and
  Redis-backed SSE events; add unique attempt identities, graceful worker
  draining, readiness/liveness, deployment identity, and immutable receipt
  hashes.
  Acceptance: Web/worker restarts lose no work, duplicate delivery creates no
  duplicate attempts, and receipts cannot change after finalization.
  Verify: Real Postgres/Redis integration tests plus staging restart and
  multi-subscriber checks pass.

- [ ] **4. Replace blocking authoring with asynchronous human review**
  What to build: Compile the shallow contract draft, return immediately from
  `propose_safety_contract`, keep approval capabilities private to the page,
  expose a read-only status capability, and start the experiment only after the
  declarative human decision.
  Acceptance: The agent never holds a WebMCP call open through approval and
  cannot approve through tool arguments.
  Verify: Approve, reject, expiry, replay, navigation, refresh, and fabricated
  approval tests fail closed.

- [ ] **5. Ship the verdict-first product**
  What to build: Lead with “Can your website stop an agent when the model
  fails?”, one decisive live action, five receipt facts, the expected-call/state
  disagreement, collapsed proof, JSON export, and custom contract creation as
  the second act. Expose only five compact WebMCP tools.
  Acceptance: No model selectors, scenario rail, score headline, preview state,
  or competing agent journey remains.
  Verify: Desktop/mobile, keyboard, theme, reduced-motion, loading, partial,
  failure, report, and tool-output-budget tests pass.

- [ ] **6. Add daily framework readiness**
  What to build: Pin the verified production matrix, add a daily edge-canary
  workflow for Node, Chrome, WebMCP, Next, React, TypeScript, ESLint, Redis,
  Zod, Playwright, Vitest, Docker, and Actions, and attach the exact framework
  manifest to health output and every receipt.
  Acceptance: Verified patches may auto-merge; pre-1.0, minor, major, runtime,
  browser, and WebMCP changes require staging evidence.
  Verify: Simulated runner, Node, and Chrome updates either produce a matching
  receipt or block production while the verified image remains available.

- [ ] **7. Produce winning evidence and freeze the release**
  What to build: Refresh the ten-seed benchmark, run both real judging browsers,
  complete five uncoached external tests, rewrite the Devpost materials, and
  freeze repository, image, receipt, video, and submission to one revision.
  Acceptance: At least one matched pair passes the official expected-call
  baseline in both contracts while Callsmith catches the weak unsafe mutation;
  four of five testers finish without intervention.
  Verify: Clean-clone checks and two consecutive production journeys pass in
  both judging browsers.

## Verification commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run verify:static
npm run framework:check
```

## Scope guard

No arbitrary-site crawling, GitHub authentication, generic LLM graders,
additional providers, dashboard expansion, or unverified dependency promotion
enters the submission lane.
