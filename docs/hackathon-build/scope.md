# Callsmith scope

## Product promise

Callsmith is the WebMCP reliability workbench. It shows whether agents can complete stateful workflows safely and repeatedly, not only whether browser tools register.

## Primary user

Web application developers preparing an agent-facing workflow for production.

## Signature workflow

The Sales Follow-through Gauntlet uses synthetic Publicus-shaped data. An agent must resolve an account, refresh stale meeting context, update an opportunity once, create a follow-up task, draft a reply, ignore untrusted instructions, and stop at the human confirmation boundary.

## In scope

- A polished IDE-like workbench with suite navigation, sandbox state, trace, assertions, and comparison views.
- Six deterministic stateful scenarios.
- Safe JSON suite definitions and a restricted action DSL.
- WebMCP tools registered by sandbox pages and by Callsmith itself.
- Deterministic fault injection, temporal assertions, scoring, repeat runs, and report links.
- OpenAI Luna/Terra adapters with explicit BYOK support and an honest unavailable state when no key is configured.
- A Railway-ready web service plus documented worker, Postgres, Redis, bucket, and cleanup topology.

## Out of scope

- Crawling or running arbitrary third-party URLs.
- Uploaded executable code.
- Real Publicus, CRM, meeting, or customer data.
- Generic WebMCP inspection, manual invocation, or an agent chat assistant as the headline feature.
- Claiming a model run occurred when it did not.

