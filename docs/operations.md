# Railway operations

## Services

The Railway project uses one source image in two roles:

- `web`: Next.js server;
- `runner`: Redis Streams consumer and Chrome WebMCP worker.

It also uses Railway Postgres and Redis. Web and worker communicate over private
networking; the sandbox uses the public HTTPS origin because WebMCP requires a
secure browser context.

## Required variables

Web:

- `DATABASE_URL`
- `REDIS_URL`
- `CALLSMITH_RUNNER_TOKEN`
- `CALLSMITH_PUBLIC_URL`
- `RAILWAY_GIT_COMMIT_SHA` (provided by Railway)

Worker:

- `REDIS_URL`
- `CALLSMITH_RUNNER_TOKEN`
- `CALLSMITH_WEB_INTERNAL_URL`
- `CALLSMITH_PUBLIC_URL`
- the model-provider credential required by the `vercel` backend

The runner token must match and must never be exposed to browser code. Model
credentials stay in the worker and never enter proposals, experiment rows,
events, receipts, or logs.

The worker fails startup when the provider credential is absent or blank. The
web service must not receive that credential; readiness is derived from the
worker heartbeat.

## Health

- `/api/health/live`: process liveness.
- `/api/health/ready`: database, Redis, and recent worker heartbeat.
- `/api/health`: detailed framework manifest and dependency readiness.

Railway liveness should use `/api/health/live`; promotion and traffic
readiness should use `/api/health/ready`.

## Recovery

Experiment creation and its outbox row commit in one Postgres transaction. Web
attempts immediate Redis dispatch; if that fails, it still returns the durable
operation with `pending_retry`. The worker polls the outbox, writes a Redis
Stream message, and marks dispatch.

Workers renew the pending-message lease every 20 seconds. A replacement worker
claims an abandoned message after 60 seconds, skips existing variant attempts,
and resumes missing work. `SIGTERM` stops intake and drains the current
experiment before exit.

## Promotion

1. Build one image from the pinned Dockerfile.
2. Run static, lint, type, coverage, build, Playwright, Docker, official smoke,
   and real browser-use gates in staging.
3. Record the image digest and framework manifest.
4. Promote that same digest to production.
5. Run production read-only discovery and one explicitly authorized decisive
   proof.

Do not rebuild production from mutable browser packages during promotion.
Daily framework changes enter the edge-canary workflow, never the verified lane
directly.

## Ten-seed benchmark

The authenticated benchmark lane creates up to ten seed-overridden experiments
without changing the public one-click contract:

```bash
CALLSMITH_BENCHMARK_URL=https://staging.example \
CALLSMITH_RUNNER_TOKEN=... \
npm run benchmark:browser
```

The JSON artifact records coverage, failures, Wilson intervals, pair latency,
receipt hashes, and exact execution provenance. It cannot issue a conclusion
for an incomplete pair because only finalized receipts enter its rates.
