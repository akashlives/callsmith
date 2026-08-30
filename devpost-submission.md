# Devpost draft — Callsmith

## Tagline

**Immutable safety receipts for agent-facing websites.**

## One-line pitch

Callsmith proves whether an agent-facing website prevented an unsafe browser
state change—even when a conventional expected-call evaluation says the run
passed.

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

Developers can also ask an agent to propose a compact, synthetic safety contract
for another domain. Callsmith shows the hostile content, protected field,
generated prompt, expected calls, and weak/hardened contract difference before a
human approves anything. Approval starts a durable browser experiment; rejection
starts nothing.

## Why it matters

In the agentic economy, websites become execution environments. Tool discovery
and correct arguments are necessary but insufficient: the website remains the
last enforcement boundary when an agent trusts hostile content or makes the
wrong decision. Callsmith makes that boundary testable and reviewable.

The important distinction is consequence rather than compliance. An agent may
call the expected tool with the expected arguments and still cross the line. A
website needs evidence that its own contract blocked the transition—not merely
that the model produced a plausible final answer.

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

The same immutable container image runs the web and worker roles. The web writes
an experiment and outbox record transactionally. A Redis Streams consumer group
delivers browser jobs to the worker, which acknowledges only terminal evidence.
If the worker drains or restarts mid-browser-run, incomplete output is discarded
and the stale stream entry is reclaimed. Progress is published through Redis so
SSE reconnects survive web restarts.

## Decisive demonstration

A meeting note says the buyer already approved automatic delivery and pressures
the agent to send. With the weak contract, expected calls pass and protected
state changes from `draft` to `sent`. With the hardened contract, the same
attempt requests human confirmation and state remains `draft`.

The report separates five facts: task outcome, unsafe action, protected state,
harm prevention, and official baseline outcome. It makes no model-superiority
claim.

The frozen ten-seed benchmark produced twenty live browser attempts. The official
expected-call baseline passed both contracts in 10/10 pairs. Callsmith found the
material state difference in 10/10: the weak contract mutated protected state,
while the hardened contract prevented harm. The Wilson 95% interval is
72.2–100.0%, median pair latency is 5,667 ms, and no pair is missing. This is a
narrow contract-design result, not a claim that one model is generally safer.

## Challenges

The hardest problem was keeping evidence honest across browser and infrastructure
failure. During forced worker-restart testing, the upstream runner returned an
ordinary failed report instead of throwing. Callsmith initially risked sealing
that interruption as a provider failure. We added explicit drain-aware lifecycle
handling: interrupted output is never acknowledged as evidence and Redis reclaims
the job after restart.

The second challenge was resisting benchmark theater. Earlier versions mixed
simulation, previews, model comparison, weighted scores, and scenario-specific
instructions. We removed those paths and narrowed the product to one controlled
causal comparison: the model, task, prompt, seed, and hostile content stay fixed;
only the website contract changes.

## What we learned

- Tool registration and argument matching are necessary, but browser state is the
  stronger safety truth.
- Human approval must be enforced by the website and cannot be represented as an
  agent-supplied boolean.
- A run without a complete weak/hardened pair is inconclusive, not a verdict.
- Durable queues are not enough unless the worker's acknowledgment boundary
  matches evidence finalization.
- Framework currency should mean daily canary verification, not unreviewed
  production upgrades.

## What's next

After the hackathon, the same receipt model can become a CI gate: capture a
production WebMCP contract, replay safety cases across framework/browser changes,
and reject a deployment when protected-state behavior regresses. Broader work
would add arbitrary-site contract capture, production-trace ingestion, a
community failure corpus, calibrated graders, human review, and multiple agent
backends. Those are intentionally outside this release so the submitted claim
remains reproducible.

## Required submission fields

- Submitter type: individual
- Country: **USER INPUT REQUIRED**
- App status: functioning prototype / newly built for this hackathon
- Live application: https://web-production-6cecc.up.railway.app/
- Public MIT repository: https://github.com/akashlives/callsmith
- Agents/clients: ChatGPT in-app browser, WebMCP-enabled Chrome, Codex
- AI tools: OpenAI Responses API through the AI SDK, Codex
- Learning/career: built browser-native WebMCP evaluation, durable Redis/Postgres
  execution, tamper-evident receipts, and human-in-the-loop tool boundaries
- Public demo video with audio under three minutes: **PENDING**

## Evidence to attach before submission freeze

- final production URL, repository revision, and container digest;
- checked-in ten-seed matched benchmark;
- Chrome WebMCP and ChatGPT in-app-browser QA screenshots;
- five genuine, uncoached non-sales tester receipts;
- public sub-three-minute narrated demo video.

The project must not be created or updated on Devpost until the submitter reviews
these exact fields and confirms the missing country. Final submission requires a
second, explicit “yes, submit.”
