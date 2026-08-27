# Callsmith

> Forge tool calls that hold up in the real world.

Callsmith is the chaos and safety layer for browser-native WebMCP evaluations. Its one-click meeting-note case runs the same agent against weak and hardened website contracts, then checks what actually changed in the browser.

**Live workbench:** [web-production-6cecc.up.railway.app](https://web-production-6cecc.up.railway.app/)

**Source:** [github.com/akashlives/callsmith](https://github.com/akashlives/callsmith)

It is being built for [The WebMCP Challenge](https://webmcp.devpost.com/). The featured Sales Follow-through Gauntlet uses synthetic data shaped like a real post-meeting workflow: identify the right account, refresh context, update the opportunity once, create follow-up work, draft a response, and stop at the human confirmation boundary.

## Why Callsmith

`webmcp-evals` can prove that expected calls appeared. Callsmith asks the consequential question: did an unsafe state transition happen, did the agent attempt it, and did the website prevent harm?

- Deterministic stateful fault injection
- Temporal and state assertions over exact tool trajectories
- Same model, task, seed, and hostile content across contract variants
- Official `webmcp-evals@0.0.3` browser execution and expected-call baseline
- Separate task-complete, unsafe-attempt, unsafe-mutation, and harm-prevented outcomes
- Read-only shareable reliability reports
- Agent-native controls exposed through WebMCP

## Local development

Requirements: Node.js 22+ and npm.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open <http://localhost:3000>. Chrome testing requires the WebMCP testing feature documented by the challenge. Callsmith remains fully usable when `document.modelContext` is unavailable.

Browser-native production runs require Chrome Canary/unstable with WebMCP enabled, Redis, the dedicated worker, a server-side provider key, and `CALLSMITH_PUBLIC_URL` pointing to the HTTPS sandbox origin. Worker callbacks use private networking, but WebMCP browser pages require a secure context. Server simulation and deterministic preview remain explicit fallbacks; neither is labeled as browser WebMCP evidence.

Run the checked-in official baseline directly:

```bash
npx webmcp-evals \
  --backend vercel \
  --model openai:gpt-5.6-luna \
  --reporter json \
  browser \
  --url 'http://localhost:3000/sandbox/sales-follow-through/injection-confirmation?contract=weak&seed=606' \
  --evals evals/signature-baseline.json
```

The repository applies a reviewed compatibility patch to `webmcp-evals@0.0.3`.
For GPT-5.6 judge runs it sets `reasoningEffort: "none"` (required by the Chat
Completions backend used by this release) and requests the provider’s `fast`
service tier. It also enforces the CLI’s configured browser step cap and clones
the Chrome flags array so the preflight launch cannot strip WebMCP from the
actual evaluation browser. The neutral agent policy, dynamic tool refresh,
browser `document.modelContext` invocation, trajectory matcher, and report
scorer are otherwise unchanged. The full patch is committed in
[`patches/webmcp-evals+0.0.3.patch`](patches/webmcp-evals+0.0.3.patch).

## Verification

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

The milestone contract and verification gates live in [`docs/hackathon-build/checklist.md`](docs/hackathon-build/checklist.md).

## Core API

- `POST /api/runs` — start one model or a comparison run
- `GET /api/runs/:id` — read run status and results
- `GET /api/runs/:id/events` — stream run events with SSE
- `POST /api/runs/:id/share` — create a read-only report token
- `GET /r/:token` — open an unlisted report
- `GET /api/health` — deployment health
- `POST /api/suites` — import a validated JSON-only suite
- `POST /api/suites/validate` — validate without importing

## Security boundaries

- Synthetic data only; no Publicus or customer records
- Hosted sandbox suites only; no arbitrary URL execution
- Safe declarative action DSL; no uploaded JavaScript
- Hardened mutations are idempotent and consequential actions require confirmation
- BYOK secrets are ephemeral and excluded from persistent output and logs

## Railway topology

The production path is a Dockerized Next.js web/API service, Postgres-backed reports, a Redis reliable queue, and a dedicated Chrome-unstable worker. The worker uses Railway private networking and posts signed browser evidence back to the web service. Queue jobs contain no request-scoped API key.

The suite schema and non-sales starter are documented in [`docs/suite-format.md`](docs/suite-format.md).

See [`docs/hackathon-build/spec.md`](docs/hackathon-build/spec.md) for the implementation contract and [`docs/architecture.md`](docs/architecture.md) for deployment boundaries.

## License

[MIT](LICENSE) © 2026 Akash Shetty
