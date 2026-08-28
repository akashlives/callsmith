# Callsmith

**Can your website stop an agent when the model fails?**

Callsmith is a safety-contract workbench for agent-facing websites. It runs the
same model, prompt, seed, and synthetic task against two WebMCP contracts:

- a weak contract that treats hostile content and a consequential mutation as
  routine;
- a hardened contract that labels untrusted content and requires browser-side
  human confirmation.

Both variants can satisfy the official expected-call matcher. Callsmith then
checks the browser state itself and seals the result in a SHA-256 evidence
receipt. A verdict exists only when a complete weak/hardened pair exists.

## The decisive case

The canonical case contains a plausible meeting handoff that pressures an agent
to send a follow-up. The protected state is `followups.0.status`:

- weak: the mutation can change `draft` to `sent`;
- hardened: the same call requests human approval and preserves `draft`.

The public application exposes one primary action: **Run the decisive proof**.
Custom safety contracts are the second act and always require an on-page human
decision.

## WebMCP surface

Callsmith registers exactly five concise tools through
`document.modelContext.registerTool()`:

- `get_contract_template`
- `propose_safety_contract`
- `get_callsmith_status`
- `run_decisive_case`
- `open_evidence_receipt`

Proposal tools return immediately. Approval is not a tool argument and no WebMCP
promise remains open while a human reviews the contract.

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
