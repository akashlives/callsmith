# Callsmith proof-to-platform winning checklist

Build mode: parallel implementation tracks with a participant review pause at
every capability milestone. Every passing increment deploys to staging;
production promotion requires automated checks and browser-use verification in
the two judging browsers.

The winning gate is not that an expected tool call appeared. It is that
Callsmith proves whether the browser reached an unsafe state and whether the
website prevented harm.

- [x] **1. Establish truthful efficacy semantics**
  Spec ref: Winning claim and 60-second evidence decision.
  What to build: Add `pending`, `conclusive`, `inconclusive`, and
  `provider_failure` paired-evidence states; migrate older reports; gate every
  safety verdict on a completed weak/hardened browser pair.
  Acceptance: Partial or one-contract evidence never presents a safety winner.
  Existing canonical shared reports remain readable.
  Verify: Contract, store, API, and component tests cover every evidence state;
  reopen both canonical production reports and browser-check the resulting copy.

- [x] **2. Create the durable unlisted suite registry**
  Spec ref: Durable guest authoring.
  What to build: Persist immutable suite definitions and drafts in Postgres with
  hashed capability tokens and version uniqueness.
  Acceptance: A guest suite survives web and worker restarts, stays out of the
  public catalog, and cannot be fetched or run without its token.
  Verify: Restart both services and exercise valid, invalid, missing, expired,
  and incorrect-token paths.

- [x] **3. Build the V2 safe authoring compiler**
  Spec ref: `GuidedSuiteDraft` and generic contract design.
  What to build: Compile bounded JSON-only drafts to `SuiteDefinitionV2`, derive
  assertions and walkthroughs, and make weak/hardened transformation generic.
  Acceptance: A non-sales gauntlet is created without code changes; executable
  content and inconsistent state references are rejected clearly.
  Verify: Golden sales/support fixtures and adversarial code, prototype, unknown
  collection, missing confirmation, and invalid final-state fixtures pass.

- [ ] **4. Make Callsmith practice its own confirmation discipline**
  Spec ref: `draft_and_run_suite`.
  What to build: Register authoring tools, show an exact review surface, and wait
  for an explicit human approve/reject decision before publication or execution.
  Acceptance: An agent cannot fabricate approval; rejection creates no run.
  Verify: Unit and browser coverage for approve, reject, abort, navigation,
  duplicate approval, and stale draft.

- [ ] **5. Deliver the agent-to-report judge journey**
  Spec ref: Canonical wow moment.
  What to build: Add the concise agent prompt entry point while preserving the
  manual meeting-note fallback.
  Acceptance: One prompt and one human approval authors a non-Publicus suite,
  runs both contracts, polls status, and opens the read-only report.
  Verify: Capture the flow in ChatGPT's in-app browser and WebMCP-enabled Chrome;
  reconcile the visible report with API and browser-originated evidence.

- [ ] **6. Instrument the browser runner for truthful progress**
  Spec ref: Production efficacy and latency.
  What to build: Invoke the official `webmcp-evals@0.0.3` browser backend
  programmatically and emit launch, discovery, model, tool, state, and failure
  progress without replacing evidence.
  Acceptance: Contracts remain concurrent; the UI waits up to 60 seconds and
  unfinished work remains explicitly inconclusive under the absolute guard.
  Use Railway healthcheck-gated deploys, graceful draining, private artifact
  storage, cleanup cron, environment-scoped observability, and infrastructure
  as code so the evidence path is operable and reproducible.
  Verify: At least nine of ten judge-mode pairs are conclusive within 60 seconds;
  worker recovery produces no duplicate attempts.

- [ ] **7. Refresh the decisive efficacy benchmark**
  Spec ref: Baseline-versus-Callsmith disagreement.
  What to build: Produce a new immutable ten-seed weak/hardened benchmark with
  separate task, unsafe-attempt, unsafe-mutation, and prevented-harm outcomes.
  Acceptance: At least one reproducible case passes the official expected-call
  baseline on both contracts while Callsmith fails weak and passes hardened.
  Verify: Report rates, confidence bounds, latency, provenance, suite version,
  seed, browser, model, and engine from the stored artifacts.

- [ ] **8. Make browser-use QA a production promotion gate**
  Spec ref: Participant-required browser verification.
  What to build: Pair Playwright CI regression coverage with real browser-use
  acceptance testing against staging.
  Acceptance: Discovery, authoring, reject, approve, progress, conclusive and
  inconclusive reports, refresh, keyboard, mobile, themes, and reduced motion pass.
  Verify: Both supported judging browsers pass with screenshots at discovery,
  approval, verdict, baseline disagreement, and raw provenance.

- [ ] **9. Record five external adoption sessions**
  Spec ref: Mixed community evidence.
  What to build: Run an uncoached script with three warm developers and two
  WebMCP challenge participants.
  Acceptance: Four complete the flow without intervention and all five explain
  why expected-call success is insufficient after one report.
  Verify: Preserve consented recordings, suites, reports, confusion notes, and
  one new failure-mode idea per tester.

- [ ] **10. Produce and freeze the winning submission**
  Spec ref: Devpost delivery.
  What to build: Rewrite the stale submission, update documentation, select final
  evidence, and record a sub-three-minute browser-native demo.
  Acceptance: The video shows discovery, authoring, approval, real execution,
  contract evidence, baseline disagreement, benchmark statistics, and adoption.
  Verify: A clean clone passes all checks; both judging browsers pass production;
  repository, deployment, reports, video, and Devpost entry share one release.

## Verification commands

```bash
npm run typecheck
npm run lint -- --quiet
npm test
npm run build
npm run test:e2e
```

## Completed foundation

The browser-native runner, Redis recovery, weak/hardened contract comparison,
official expected-call baseline, canonical 20-attempt benchmark, strict V1 suite
format, and Support Escalation starter were completed in the ruthless reset.
Their production evidence remains in [`ruthless-evidence.md`](ruthless-evidence.md).

## Scope guard

Until items 1–9 pass, do not add GitHub authentication, arbitrary-site crawling,
generic LLM graders, more providers, or dashboard expansion. SOTA runway work may
start only after two consecutive production judge journeys pass in both browsers.
