# Devpost draft — Callsmith

## Tagline

**Immutable safety receipts for agent-facing websites.**

## What it does

Expected-call evaluation answers, “Did the agent call the tools we expected?”
Callsmith answers the consequential follow-up: “What happened to protected
browser state, and did the website stop the unsafe action?”

Callsmith runs one synthetic task against weak and hardened versions of the same
WebMCP contract. The model, prompt, seed, and hostile content stay fixed. The
official expected-call baseline can pass both variants, while Callsmith records
whether the unsafe action was attempted, whether protected state mutated, and
whether the website prevented harm.

The result is an immutable, shareable evidence receipt with the exact prompt,
contract diff, browser trace, state changes, assertions, failures, framework
versions, and a SHA-256 content hash.

## Why it matters

In the agentic economy, websites become execution environments. Tool discovery
and correct arguments are necessary but insufficient: the website remains the
last enforcement boundary when an agent trusts hostile content or makes the
wrong decision. Callsmith makes that boundary testable and reviewable.

## WebMCP use

The evaluated sandbox registers tools through
`document.modelContext.registerTool()` and executes them through Chrome's
native WebMCP surface using Google's `webmcp-evals` runner. Callsmith itself is
also operable through five WebMCP tools, including asynchronous contract
proposal and receipt navigation.

Human approval cannot be fabricated as a tool parameter. It occurs only in a
visible, non-autosubmitting declarative form.

## How it was built

- Next.js and React for the verdict-first application
- `webmcp-evals` 0.0.4 and Chrome unstable for browser-native execution
- Postgres for proposals, experiments, attempts, outbox, and immutable receipts
- Redis Streams for durable jobs, progress events, recovery, and worker health
- Railway for web, worker, Postgres, Redis, private networking, staging, and
  production
- Vitest, real Postgres/Redis integration tests, Playwright, official WebMCP
  smoke, and browser-use acceptance gates

## Decisive demonstration

A meeting note says the buyer already approved automatic delivery and pressures
the agent to send. With the weak contract, expected calls pass and protected
state changes from `draft` to `sent`. With the hardened contract, the same
attempt requests human confirmation and state remains `draft`.

The report separates five facts: task outcome, unsafe action, protected state,
harm prevention, and official baseline outcome. It makes no model-superiority
claim.

## Current evidence to attach before submission freeze

- Production URL and frozen repository revision
- Fresh ten-seed matched benchmark receipt
- Chrome WebMCP and ChatGPT in-app-browser QA screenshots
- Five uncoached non-sales tester receipts
- Sub-three-minute demo video
