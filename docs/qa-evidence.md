# QA evidence

Last updated 2026-08-31. This file separates completed evidence from release
gates; a fixture, screenshot, or prior benchmark never substitutes for a live
browser result.

## Automated gate

- static reset guard and `knip`: pass;
- ESLint and TypeScript: pass;
- Vitest locally: 57 pass, 2 service-backed tests skipped when integration URLs
  are absent;
- release CI: pass with real Postgres 17 and Redis 8 services;
- library coverage gate: at least 85% statements and 75% branches;
- Next.js production build and immutable Docker image build: pass;
- Playwright desktop/mobile regression suite: pass;
- npm audit: zero known vulnerabilities;
- official `webmcp-evals` 0.0.4 smoke on staging: weak and hardened tools were
  discovered and invoked through Chrome WebMCP.

The regression suite covers decisive guest proof, receipt-derived outcomes,
truthful failures, five-tool discovery, asynchronous proposal review, reject,
approve, replay protection, status polling, mobile layout, keyboard activation,
theme persistence, reduced motion, and hydration.

The service-backed integration gate covers Postgres persistence, separate
capabilities, outbox dispatch, Redis Stream progress replay, unique attempt
identity, receipt finalization, database-enforced immutability, and one-shot
human decisions.

## Staging recovery evidence

Verified against application revision
`2bfc2184515591aefa4d66de1d7fd712842d3c6e`:

- a real Luna weak/hardened pair completed with native browser provenance;
- forced runner restart reclaimed the job and produced exactly two terminal
  attempts, with no duplicate mutation;
- forced web restart preserved experiment progress and SSE reconnects;
- incomplete browser reports produced during worker drain are discarded and
  retried instead of being sealed as provider failures;
- the weak contract mutated protected state and the hardened contract preserved
  it through browser-mediated confirmation.

## Immutable benchmark

The checked-in benchmark contains ten fixed seeds and twenty browser attempts:

- completed pairs: 10/10;
- official expected-call baseline passed both contracts: 10/10;
- baseline/Callsmith disagreement: 10/10;
- weak unsafe mutation: 10/10;
- hardened harm prevention: 10/10;
- Wilson 95% interval for each observed 10/10 rate: 72.2–100.0%;
- median pair latency: 5,667 ms;
- browser: Google Chrome 154.0.8025.0 dev;
- runner: `webmcp-evals@0.0.4`;
- missing pairs: zero.

The JSON artifact preserves every receipt hash, seed, outcome, browser version,
runner version, model/backend, application revision, and framework-manifest
revision.

## Final release-candidate identity

- application revision: `548987bda92eb79c968b5cbb361cb66827e59529`;
- verified container digest:
  `sha256:77b323764ede4db454ef81bd67d2e9bae6165647dc74cc73a938e79bce66dbae`;
- Railway staging web and runner use that same digest;
- runtime framework-manifest revision:
  `3d1a8d1aa527521b3fc396aa205b1cced7700b1e6c5ab204eab1dea25d99766d`;
- GitHub verify gate: static analysis, lint, typecheck, real-service coverage,
  build, desktop/mobile Playwright, and Docker all pass.

## Real browser-use acceptance

Completed in ChatGPT's in-app browser against staging:

- native discovery of all five Callsmith tools;
- canonical decisive run and receipt opening through WebMCP;
- non-sales support contract proposal;
- explicit rejection with no experiment created;
- regenerated proposal, visible human approval, completed comparison, and
  immutable receipt;
- truthful inconclusive custom result when the hardened agent did not exercise
  the protected action;
- theme persistence and responsive inspection;
- no browser-console errors on the inspected canonical and custom receipts.

The responsive inspection found a 43 px receipt overflow caused by a long
SHA-256 value. The value and disclosure labels now wrap without changing the
narrative order; Playwright mobile regression passes.

Completed in Chrome 152 with WebMCP enabled through the official native
`page.webmcp` surface:

- all five Callsmith tools discovered;
- a synthetic non-sales refund contract opened a human review;
- rejection persisted and created no experiment;
- a replacement proposal reset the decision UI instead of inheriting the prior
  rejection;
- visible approval queued one experiment;
- the experiment completed and its receipt opened through WebMCP;
- browser-console errors captured during tool execution: zero.

That test found and closed a real state-isolation defect: a second proposal on
the same page previously inherited the first review's terminal decision. The
review component is now keyed by immutable proposal ID and has a regression
test. Chrome also passed two consecutive visible decisive journeys, official
native weak/hardened smoke, and all ten benchmark pairs.

The final in-app-browser check opened a conclusive canonical receipt through
Callsmith's WebMCP tools. At a 390 px emulated viewport, the deployed receipt had
375 px client and scroll widths—zero horizontal overflow.

## Demo asset

The 97-second cream-hero cut at `outputs/callsmith-demo-final.mp4` is obsolete.
Production now shows the Attio-like CRM pair. A silent 1440×900 walkthrough of
the live URL (idle RECORD pair, then sealed SENT vs DRAFT·HELD on
`/r/38JcJ41Z85ccqww-22kilE3SLai6CpDE_BgquQApUqI`, no production Run click) is at
`outputs/callsmith-demo-restage.webm`. It remains a draft until the submitter
adds narration under three minutes and explicitly approves a public YouTube
upload. DevTools `document.modelContext.getTools()` must be captured in that
narrated cut; this silent file only covers the visual punchline.

## External session protocol

Each 12-minute session is uncoached after setup:

1. Obtain recording consent and give the tester the production URL.
2. Ask them to use an agent to propose a non-sales safety boundary from their own
   work, then review the generated hostile content and protected state.
3. They reject one proposal, regenerate or edit it, approve the next proposal,
   wait for the browser comparison, and open the receipt.
4. Ask, “What did Callsmith catch that an expected-call test would miss?”
5. Record whether the journey completed without intervention, the answer in the
   tester's own words, the receipt URL, and one new failure-mode idea.

Recruitment copy (not yet posted):

> I’m testing Callsmith, a WebMCP safety workbench that checks whether a website
> actually prevented an unsafe agent action. I need five developers for a
> recorded 12-minute, uncoached test using synthetic data—no credentials or
> customer systems. You’ll turn one risky workflow from your domain into a safety
> contract and tell me where the experience breaks.

## Remaining human/external release gates

- record five uncoached external non-sales contract sessions (four must complete
  without intervention and all five must explain the value);
- narrate and publish the restage walkthrough as a public video under three
  minutes (silent live cut is local; YouTube URL needs upload approval);
- obtain the submitter country and explicit approval before creating/updating the
  Devpost project, then obtain a separate explicit “yes, submit” before final
  submission.

Production web was promoted 2026-08-31 (Railway deployment
`9f56afbd-a224-40b4-8266-30dc67d76be3`) from `visual-2026-proof` `12dd946`.
Health `/api/health/ready` reported database, queue, and worker true. Existing
sealed receipts show SENT vs DRAFT·HELD. The runner still uses the prior GHCR
digest `sha256:77b323764ede4db454ef81bd67d2e9bae6165647dc74cc73a938e79bce66dbae`.
Do not click production Run unless explicitly authorized (paid Luna, seed 606).

No remaining gate may be replaced with fabricated tester evidence, fixture
playback, or a model-superiority claim.
