# Milestone 4 confirmation verification

Verified release: `ce47f06` (`feat: require human approval for authored suites`)

## Authority boundary

- `get_authoring_guide` is read-only and describes the bounded JSON workflow.
- `draft_and_run_suite` accepts only `GuidedSuiteDraft`; its exact generated
  schema contains no approval boolean, confirmation token, owner capability, or
  run identifier.
- Owner and confirmation capabilities remain inside the coordinator's private
  transport handle. They never enter React state, the DOM, WebMCP output,
  storage, reports, or logs.
- Approval and rejection are issued only by the on-page decision authority. A
  decision is single-use and bound to the active compiled review.
- Abort, navigation, expiry, rejection, duplicate decisions, and stale reviews
  cannot start a run. Rejection best-effort invalidates the server draft.

## Exact review evidence

Before either decision, the modal shows:

- suite identity, domain, and agent goal;
- every read and mutation tool;
- the hostile-content fixture and its source tool;
- the protected state path with safe and unsafe values;
- confirmation and idempotency requirements; and
- all four compiler-derived assertion categories.

Reject receives initial keyboard focus, both decisions are locked while one is
being recorded, focus is trapped and restored, Escape aborts safely, and status
or error changes are announced semantically.

## Automated verification

- Lint and TypeScript: passed.
- Vitest: 24 files, 152 tests passed.
- Next.js 16 production build: passed.
- Playwright: 14 tests total; 12 passed across desktop Chromium and mobile, 2
  live-deployment tests intentionally skipped in the local run.
- The focused browser suite covers fabricated approval input, approve, reject,
  abort, navigation, duplicate approval, and stale review behavior.

## Railway staging evidence

- Web deployment: `0e6a7860-d904-4bb4-8225-a7753498b60c`.
- Health reported Postgres persistence, Redis browser queue, model runner, and
  browser runner configured; bounded HTTP logs contained no responses at or
  above 400.
- ChatGPT's in-app browser discovered all six Callsmith tools, including
  `get_authoring_guide` and `draft_and_run_suite`.
- The generated WebMCP schema exposed no approval or confirmation-capability
  input.
- The exact Support Escalation review displayed every required item. Rejection
  produced a `rejected` draft and no run.
- Explicit approval published `m4-support-approve-8271@1.0.0` and started
  `run-0e262567-7bfe-49d6-a717-88904f4b4806`. The run completed as a conclusive
  weak/hardened pair with two `browser_webmcp` attempts from Chrome 154 dev.
- The connected Chrome profile rendered the homepage without horizontal
  overflow. It still did not advertise a WebMCP capability; Chrome discovery
  with the required WebMCP-enabled judging configuration remains Milestone 8.

## Railway production evidence

- Web deployment: `b9b2e756-085a-4203-8430-fe48f46f995e`.
- Health passed and bounded runtime/HTTP logs contained no errors or responses
  at or above 400.
- The in-app browser discovered the six production tools, read the authoring
  guide, and confirmed the schema has no fabricated-approval input.
- A production smoke review showed the exact tools, hostile content, protected
  state, and assertions. Rejecting it persisted a rejected draft; the latest
  production runs remained unchanged, proving no run was created.

## Known verification constraint

The in-app browser automation transport gives a pending WebMCP invocation a
roughly 20-second command deadline and serializes same-tab inspection behind
that call. The real review was therefore inspected and clicked immediately
after the automation call timed out. The application-level promise/decision
lifecycle itself is covered without that transport constraint by the component
and Playwright browser suites, including a decision while the tool promise is
pending.
