# Milestone 5 agent-to-report verification

Implemented release: `f122033` (`feat: deliver agent-to-report judge journey`)

Milestone state: **staging implementation verified; two-browser release gate
open**. Production was not promoted and checklist item 5 remains unchecked.

## Judge journey

- The homepage now presents one concise, copyable agent prompt after the manual
  meeting-note fallback. It asks the agent to create a synthetic support safety
  gauntlet, inspect the authoring guide, and stop for the human's on-page
  decision.
- Successful approval creates the browser comparison and an opaque read-only
  report capability in the same transaction. A report-capability failure is
  surfaced truthfully without hiding a run that already started.
- `get_run_status` returns the report share token only after the run is
  shareable. The agent can then call `open_report`; the report remains read-only.
- The prompt cannot approve on the human's behalf. The exact-review and
  single-use confirmation boundary from Milestone 4 remain unchanged.

## Automated verification

- Lint, TypeScript, and the Next.js 16 production build passed.
- Vitest passed 155 tests across 25 files with two bounded workers.
- Fourteen local desktop/mobile Playwright cases passed; two deployment-only
  cases were intentionally skipped. The suite covers prompt copy/error states,
  the approval-to-report receipt, one-request decision locking, WebMCP status
  polling, report opening, responsive layout, themes, and reduced motion.
- `git diff --check` passed.

## Railway staging evidence

- Web deployment: `59fbec9d-e84d-4b33-ae50-203aa60ac4f7`.
- The health endpoint reported Postgres persistence, Redis queueing, the model
  runner, and the browser runner configured.
- ChatGPT's in-app browser discovered all six Callsmith WebMCP tools:
  `list_suites`, `run_comparison`, `get_run_status`, `open_report`,
  `get_authoring_guide`, and `draft_and_run_suite`.
- The clean judge transaction authored and approved
  `support-escalation-judge-20260827-m5c`, then started
  `run-ff89f361-5857-4c6a-bccb-77421ce66f33`.
- WebMCP polling returned `completed` and `conclusive` with a complete weak and
  hardened pair. Both attempts recorded `browser_webmcp`, Luna, seed `3202`,
  Google Chrome `154.0.8013.2 dev`, and `webmcp-evals@0.0.3`.
- Calling `open_report` navigated to the opaque, read-only report at
  `https://web-staging-6bb1.up.railway.app/r/cnVuLWZmODlmMzYxLTU4NTctNGM2YS1iY2NiLTc3NDIxY2U2NmYzMw.7a0e890229be4978ab45fdffd105df82`.
- Direct run-API reconciliation matched the run identity, terminal evidence
  state, share token, attempt contracts, model, seed, score, browser, and engine.
  The report returned HTTP 200.
- Two interrupted review attempts were rejected or aborted and created no run;
  the product did not fabricate approval or replace the interruption with a
  success result.

## Browser release blocker

The connected Chrome profile rendered the staging homepage cleanly with no
horizontal overflow, but exposed neither `document.modelContext` nor a WebMCP
tool capability. The upstream browser engine documents Chrome Canary 150+ with
WebMCP testing enabled and launches with `--enable-features=WebMCP`; this
connected profile was not started in that configuration.

That is not a product pass. To close Milestone 5, reconnect Chrome with the
challenge-required WebMCP configuration and repeat the same discovery,
authoring, approval, status-polling, and report-opening transaction. Only then
may item 5 be checked and this release promoted to production.

