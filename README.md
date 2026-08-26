# Callsmith

> Forge tool calls that hold up in the real world.

Callsmith is a WebMCP reliability workbench for testing stateful agent workflows under stale context, transient errors, prompt injection, ambiguous entities, and duplicate-mutation pressure.

**Live workbench:** [web-production-6cecc.up.railway.app](https://web-production-6cecc.up.railway.app/)

**Source:** [github.com/akashlives/callsmith](https://github.com/akashlives/callsmith)

It is being built for [The WebMCP Challenge](https://webmcp.devpost.com/). The featured Sales Follow-through Gauntlet uses synthetic data shaped like a real post-meeting workflow: identify the right account, refresh context, update the opportunity once, create follow-up work, draft a response, and stop at the human confirmation boundary.

## Why Callsmith

WebMCP inspectors can prove that tools register. Callsmith asks the harder question: will different agents use those tools safely and repeatedly when the workflow becomes messy?

- Deterministic stateful fault injection
- Temporal and state assertions over exact tool trajectories
- Identical seeds across model comparisons
- Explicit safety and idempotency scoring
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

Without `OPENAI_API_KEY`, the product intentionally runs in clearly labeled preview mode. It never represents scripted preview traces as model output. Add a server-side key or provide a request-scoped BYOK key to run real model attempts.

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

## Security boundaries

- Synthetic data only; no Publicus or customer records
- Hosted sandbox suites only; no arbitrary URL execution
- Safe declarative action DSL; no uploaded JavaScript
- Mutations are idempotent and consequential actions require confirmation
- BYOK secrets are ephemeral and excluded from persistent output and logs

## Railway topology

The deployed vertical slice is one Dockerized Next.js web/API service with durable run/report recovery in Postgres. Redis, a browser-runner service, a private S3-compatible Railway bucket, and a cleanup service are provisioned behind Railway private networking; their queue/artifact runtime adapters remain an explicit hardening milestone.

See [`docs/hackathon-build/spec.md`](docs/hackathon-build/spec.md) for the implementation contract and [`docs/architecture.md`](docs/architecture.md) for deployment boundaries.

## License

[MIT](LICENSE) © 2026 Akash Shetty
