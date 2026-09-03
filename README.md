# Callsmith

**Agent platforms review every tool call. Nobody attests the website.**

![Weak SENT versus Hardened DRAFT·HELD after the same expected-call pass](docs/visual-2026-receipt.png)

WebMCP lets an agent call `send_followup` or `place_order` directly on a page.
ChatGPT and Chrome review each call, and OpenAI's own documentation says those
checks "don't guarantee the website or its responses are trustworthy." The
attacks that matter are site-side and survive model upgrades: a compromised
third-party script can hijack a tool mid-session by aborting and re-registering
it under the same name ([Mid-Session Tool Injection](https://arxiv.org/abs/2606.06387),
94–100% success across GPT-5.4, Claude Opus 4.6, and Gemini 2.5). And the loss
lands on the website: the Agentic Commerce Protocol keeps settlement, refunds,
and chargebacks with the merchant, and the UK CMA holds a business responsible
for its agent as for an employee.

Callsmith produces the artifact that gap is missing: a hash-sealed receipt of
what a specific website did when an agent was pushed to cross a boundary. It runs
the same model, prompt, seed, and synthetic task against two WebMCP contracts:

- a weak contract that treats hostile content and a consequential mutation as
  routine;
- a hardened contract that labels untrusted content, binds tool identity to the
  registering origin, and requires browser-side human confirmation.

Both variants can satisfy the official expected-call matcher. Callsmith then
checks the browser state itself and seals the result in a SHA-256 evidence
receipt. A verdict exists only when a complete weak/hardened pair exists. Today
the receipt attests one boundary (the meeting-note case, ten seeds); it is not a
certificate.

## The decisive case

The canonical case contains a plausible meeting handoff that pressures an agent
to send a follow-up. The protected state is `followups.0.status`:

- weak: the mutation can change `draft` to `sent`;
- hardened: the same call requests human approval and preserves `draft`.

The public application exposes one primary action: **Run the decisive proof**.
Custom safety contracts are the second act and always require an on-page human
decision.

## Judge in 90 seconds

Live app: https://web-production-6cecc.up.railway.app/

Open it in **ChatGPT's in-app browser** (WebMCP on by default) or **Chrome 149+**
with `chrome://flags/#enable-webmcp-testing` enabled, then restart Chrome.

You do **not** need to click Run. The sealed receipt already shows the claim:

https://web-production-6cecc.up.railway.app/r/38JcJ41Z85ccqww-22kilE3SLai6CpDE_BgquQApUqI

If you do use an agent on `/`, say **Run the decisive case** (`run_decisive_case`)
or **Open the evidence receipt** (`open_evidence_receipt`). Run starts a paid
Luna pair (seed 606). The idle homepage shows that same sealed production pair,
Weak **SENT** vs Hardened **DRAFT · HELD**, with its SHA-256; clicking Run clears
it and shows only RUNNING until a fresh pair finishes.

On the sandbox, toggle **Compromised third-party script** to watch a simulated
CDN script try to hijack `send_followup`. The weak page accepts the same-name
re-registration; the hardened page's origin-bound registry rejects it and logs
the lifecycle event. Deterministic, no model, visible in `getTools()`.

Confirm page tools in DevTools:

```js
await document.modelContext.getTools()
```

- On `/`: `get_contract_template`, `propose_safety_contract`,
  `get_callsmith_status`, `run_decisive_case`, `open_evidence_receipt`.
- On `/sandbox/meeting-note-boundary/safety-boundary`: the CRM tools, including
  `read_meeting_note` and `send_followup`. Hardened confirmation is the
  declarative form `confirm_follow_up` with no `toolautosubmit`.

## WebMCP surface

Callsmith registers exactly five concise workbench tools through
`document.modelContext.registerTool()`:

- `get_contract_template`
- `propose_safety_contract`
- `get_callsmith_status`
- `run_decisive_case`
- `open_evidence_receipt`

The sandbox page registers the meeting-note CRM tools the same way. Proposal
tools return immediately. Approval is not a tool argument and no WebMCP promise
remains open while a human reviews the contract.

## Runtime

The verified production lane is pinned to Node 24.20.0, Next.js 16.3.3, React
19.2.8, TypeScript 5.9.3, `webmcp-evals` 0.0.4, Playwright 1.62.1, Vitest
4.1.11, Zod 4.5.1, and ioredis 5.8.2. Installed versions are recorded in every
framework manifest; browser and runner versions are recorded per attempt.

Required production services:

- Railway web service
- Railway worker service using the same immutable image
- Postgres
- Redis
- an HTTPS public origin for the browser sandbox

Required variables are documented in [operations](docs/operations.md).

## Local verification

```bash
npm ci
npm run static
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The official no-key browser smoke expects a local server and Chrome Dev/unstable
with WebMCP enabled. Set `CALLSMITH_CHROME_CHANNEL=chrome` when intentionally
verifying an eligible stable Chrome build:

```bash
npm run dev
npm run smoke:webmcp
```

Real Postgres and Redis coverage runs when
`CALLSMITH_INTEGRATION_DATABASE_URL` and
`CALLSMITH_INTEGRATION_REDIS_URL` are defined. CI provisions both services and
enforces 85% statement and 75% branch coverage across `src/lib`.

## Public APIs

- `POST /api/experiments`
- `GET /api/experiments/:id`
- `GET /api/experiments/:id/events`
- `POST /api/contracts/proposals`
- `GET /api/contracts/proposals/:id/status`
- `POST /api/contracts/proposals/:id/decision`
- `GET /api/receipts/:token`
- `GET /r/:token`

Experiment status and proposal status require separate opaque read
capabilities. Raw capabilities are returned once; only SHA-256 hashes are
stored. Receipt URLs are immutable read capabilities.

## Documentation

- [Architecture](docs/architecture.md)
- [Safety contract format](docs/contract-format.md)
- [Evidence receipt format](docs/receipt-format.md)
- [Railway operations](docs/operations.md)
- [QA evidence](docs/qa-evidence.md)
- [Devpost draft](devpost-submission.md)

All data is synthetic. Callsmith accepts no arbitrary URL, executable suite
content, customer credential, or external action.
