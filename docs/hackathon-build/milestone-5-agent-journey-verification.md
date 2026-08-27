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

## Chrome remediation attempt

- The participant enabled `chrome://flags/#enable-webmcp-testing` and relaunched
  Chrome 152. The ChatGPT browser extension, selected profile, and native bridge
  were verified and reconnected through a fresh window.
- Official Chrome guidance requires WebMCP documents to be origin isolated and
  gated by the `tools` permissions policy. Callsmith now sends
  `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)` on every
  route; regression coverage enforces both headers.
- Railway staging deployment `a65ea475-88bc-4205-a52b-b72a550b3e42` served the
  new headers and passed health. Local lint, TypeScript, build, and all 156
  Vitest tests passed.
- The connected Chrome controller still exposes only page control. Chrome's
  official WebMCP Model Context Tool Inspector is the supported interface for
  discovering and executing the registered tools with a prompt. Installation
  requires the participant's explicit Chrome Web Store confirmation and could
  not be automated through the browser security boundary.
- The remaining gate is to install that Google-published inspector, reopen
  Callsmith staging, and execute the full prompt-to-report flow through it.

## Gemini Inspector interoperability remediation

- The participant installed the official Inspector and supplied their Gemini
  key directly to it. The first exported trace showed an empty declaration set
  and an extension-side `frameId` failure from a stale page session. After a
  fresh Callsmith navigation, the second trace proved that Chrome discovered
  all six registered tools.
- Both the suite/status probe and the canonical judge prompt then failed before
  the first function call with Gemini HTTP 400. The trace isolated the cause:
  `draft_and_run_suite` advertised the complete recursive V2 JSON Schema inside
  every Gemini request. Google documents that very large or deeply nested
  function schemas may be rejected.
- Release `f0bdb73` keeps the complete V2 schema in `get_authoring_guide` and in
  Callsmith's Zod/compiler validation, but advertises one portable `draftJson`
  string parameter for the mutation tool. Parsed data still crosses the same
  strict compiler and human-only confirmation authority; no approval argument
  is exposed.
- Local lint, TypeScript, production build, 157 Vitest tests, and 14
  desktop/mobile Playwright cases passed; two deployment-only cases remained
  intentionally skipped locally.
- Railway staging deployment `9b257880-ba37-4fa8-9a14-c8dfb6797d86` is healthy
  with image digest
  `sha256:061a22f16420930f24af2784066ffb1de6a06ad7ff0d39e7c4a6716e774f8b94`.
  It preserves `Origin-Agent-Cluster: ?1` and
  `Permissions-Policy: tools=(self)`.
- The Chrome judge tab was refreshed to the new release and shows the updated
  canonical prompt. The remaining gate is one Inspector retry through authoring,
  human approval, polling, and report opening. Production remains unchanged.

## Chrome tool-result remediation

- The next exported Inspector trace proved the compact declaration fix: Gemini
  3.6 Flash accepted all six tools and made real function calls. It successfully
  executed `get_authoring_guide`, eliminating the previous HTTP 400 blocker.
- `list_suites` still failed inside Chrome. Its HTTP endpoint was healthy, but
  the tool was returning roughly 50 KB of complete suite definitions—including
  state fixtures, assertions, and tool implementations—when the agent only
  needed suite and scenario identifiers. Gemini consequently guessed
  `default/default`; `run_comparison` and `get_run_status` then failed on those
  fabricated identifiers. No run was created and no false status was shown.
- Release `aa541d1` makes `list_suites` return only suite metadata and runnable
  scenario metadata. API-backed tools now convert HTTP/network failures into a
  structured `request_failed` result instead of rejecting through WebMCP.
- Local lint, TypeScript, production build, 159 Vitest tests, and 14
  desktop/mobile Playwright cases passed; two deployment-only cases remained
  intentionally skipped locally.
- Railway staging deployment `9415a9e5-a001-4089-9f30-38f30b44728d` is healthy
  with image digest
  `sha256:2556e75898ce5b6baa1bb334fca92e4065c396bd72dd986af292feb85d64dd0c`
  and retains the required WebMCP headers.
- A fresh Chrome staging tab is open at the exact deployed release and the
  canonical 676-character judge prompt is on the browser clipboard. The
  remaining release gate is the Inspector retry and human review decision.
