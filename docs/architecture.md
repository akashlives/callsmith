# Architecture

## Target runtime boundaries

```text
Browser / ChatGPT
       │ HTTPS + SSE
       ▼
Callsmith web/API ─── Redis queue ─── browser runner
       │                    │
       ├── Postgres         └── isolated sandbox browser contexts
       └── private bucket       (no arbitrary third-party targets)
```

Only the web service is public. The worker, Postgres, Redis, and bucket remain private Railway resources. The current vertical slice executes attempts in the web service; queue handoff to the provisioned runner is a later production-hardening gate.

## Honest execution modes

- **Preview:** deterministic traces demonstrate the workbench UI and are marked `preview`.
- **Hosted:** the server uses its configured OpenAI key and applies guest/account quotas.
- **BYOK:** a request-scoped credential is held only for the active in-process comparison. It is never placed in run state, reports, analytics, or application logs.

All reports include execution provenance. Preview and provider failures can never be mistaken for completed model attempts.

## WebMCP surfaces

Sandbox routes register state-aware tools against synthetic workflow state. The workbench route registers orchestration tools that let an agent select a suite, start a comparison, inspect status, and open a report. Both adapters treat missing browser support as a capability state, not an application error.

## Persistence adapters

The hot run store is process-local so SSE updates remain immediate. When `DATABASE_URL` is present, every run and share token is also mirrored to Postgres; status and report reads hydrate from Postgres after a restart. Redis queue/events/TTL and private-bucket screenshot artifacts are provisioned but not yet wired into the vertical slice.
