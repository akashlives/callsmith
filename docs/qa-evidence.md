# QA evidence

## Current automated gate

Verified locally on 2026-08-28:

- static reset guard: pass;
- `knip`: no unused files, dependencies, or exports;
- ESLint: pass;
- TypeScript: pass;
- Vitest: 51 tests pass with real Postgres 17 and Redis 8 integration;
- library coverage: 86.5% statements, 76.52% branches;
- Next.js production build: pass;
- Playwright: 10 desktop/mobile journeys pass, 2 live-only cases skipped;
- npm audit: zero known vulnerabilities;
- official `webmcp-evals` 0.0.4 smoke: weak and hardened contracts both passed
  native discovery and invocation in Chrome 152.

The Playwright journeys cover:

- decisive guest proof from one button;
- receipt-derived verdict and disclosure;
- honest provider/start failure;
- five-tool WebMCP discovery;
- immediate proposal return;
- explicit rejection;
- explicit approval and duplicate-click protection;
- post-approval status polling;
- desktop and mobile layout;
- keyboard activation, theme persistence, reduced motion, and hydration.

The service-backed integration gate covers:

- Postgres contract and experiment persistence;
- capability separation;
- Postgres outbox dispatch;
- Redis Stream progress replay;
- unique pair attempts;
- conclusive receipt finalization;
- database-enforced mutation rejection after finalization;
- one-shot approval and rejection.

## Production promotion blockers

These remain evidence tasks, not implemented-code claims:

- official canonical weak and hardened smoke on the staged image;
- one real Luna matched pair with native browser provenance;
- worker-kill and web-restart recovery on staging;
- two consecutive journeys in ChatGPT's in-app browser;
- two consecutive journeys in WebMCP-enabled Chrome;
- fresh ten-seed immutable benchmark;
- five uncoached external non-sales contract sessions;
- frozen video, receipt, image digest, repository revision, and Devpost copy.

No pending item may be replaced with fixture evidence or a model-superiority
claim.
