# Technical specification

## Application

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS.
- The root page renders a server-authored narrative shell with a focused client runner; `RunResult` is adapted into verdict, plain-language evidence, state facts, and developer evidence without a duplicate fixture contract.
- Adaptive light/dark theme selection is applied before first paint and persisted only as a local presentation preference.
- Server route handlers expose run, event, share, suite validation, sandbox, and health interfaces.
- A typed in-memory repository is the development and guest fallback; persistence interfaces permit Postgres/Redis implementations without changing UI contracts.
- The OpenAI runner is server-only and activated only when a server key or request-scoped BYOK key is present.

## Core contracts

- `SuiteDefinition`, `ToolDefinition`, `ScenarioDefinition`, `FaultProfile`, `TraceAssertion`, `TraceEvent`, `AttemptResult`, `RunResult`, and `Scorecard` live in `src/lib/contracts.ts`.
- Safe actions are `query`, `get`, `patch`, `append`, and `transition`.
- Faults are deterministic functions of suite version, scenario, and seed.
- Trace assertions support tool presence/absence, ordering, argument matching, state equality, maximum calls, and final response content.

## Runtime flow

1. `POST /api/runs` validates the request and quota, then creates a run.
2. The runner seeds a fresh scenario state and executes attempts against identical fault schedules.
3. Trace events and state diffs append to the run record and stream over SSE.
4. Assertions and scoring run after every attempt; partial provider failures remain visible.
5. `POST /api/runs/:id/share` creates an opaque read-only token rendered by `/r/:token`.

## WebMCP

- A small adapter detects `document.modelContext`; the regular web app remains functional when unsupported.
- The sandbox registers scenario tools imperatively and cleans them up on unmount/state transition.
- The workbench registers navigation/orchestration tools.
- Tool outputs treat external-looking text as untrusted content and never automatically cross the confirmation boundary.

## Railway

- Production target is a new personal `callsmith` project.
- Initial deploy is the Next.js web/API service.
- Expansion services: browser runner, Postgres, Redis, private bucket, cleanup cron.
- Services communicate over Railway private networking; only the web service receives a public domain.

## Verification

- Vitest covers contracts, deterministic faults, assertions, scoring, store isolation, and secret redaction.
- Playwright covers first-run workbench, preview comparison, report view, responsive UI, and browser-side WebMCP adapter behavior through a test polyfill.
- `npm run lint`, `npm test`, `npm run build`, and a production health check are release gates.
