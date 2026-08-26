# Callsmith autonomous build checklist

Mode: autonomous
Verification pauses: automated milestone gates; pause only on missing credentials or destructive/external decisions
Comprehension checks: disabled
Git cadence: commit after each verified milestone
Wow moment: identical agents face stale context, prompt injection, and a duplicate-mutation trap; the trace comparison makes the safer model obvious

- [x] **1. Establish the vertical slice**
  Spec ref: `spec.md > Application`
  What to build: Branded workbench shell, one sales scenario, typed run store, run API, event stream, and honest preview trace.
  Acceptance: A guest can start a run and see state, trace, score, and provenance without setup.
  Verify: `npm run lint && npm test && npm run build` plus browser smoke test.

- [x] **2. Define suite and action contracts**
  Spec ref: `spec.md > Core contracts`
  What to build: Versioned Zod schemas, safe DSL validation, fixtures, and actionable validation errors.
  Acceptance: A second suite can be represented without application code and arbitrary executable input is rejected.
  Verify: Contract unit tests and invalid fixture tests.

- [x] **3. Build deterministic evaluation**
  Spec ref: `spec.md > Runtime flow`
  What to build: Seeded fault injection, trace normalization, assertions, scoring, idempotency guard, and failure explanations.
  Acceptance: Known good/bad traces score predictably and identical seeds create identical faults.
  Verify: Eval-engine unit tests covering every fault and assertion type.

- [x] **4. Implement the six-scenario gauntlet**
  Spec ref: `scope.md > Signature workflow`
  What to build: Happy, ambiguity, stale, transient, duplicate, and injection/confirmation scenarios with success and failure traces.
  Acceptance: Every scenario requires meaningful multi-tool state transitions and synthetic data is explicit.
  Verify: Fixture completeness test and scenario walkthrough test.

- [ ] **5. Add WebMCP surfaces** *(implementation complete; supported-browser discovery gate remains)*
  Spec ref: `spec.md > WebMCP`
  What to build: Browser adapter, dynamic sandbox tools, declarative confirmation form, and Callsmith orchestration tools.
  Acceptance: Tools register with strict schemas/annotations and clean up correctly; non-WebMCP browsers remain usable.
  Verify: Unit polyfill test plus manual Chrome/ChatGPT verification checklist.

- [ ] **6. Add real model adapters**
  Spec ref: `spec.md > Runtime flow`
  What to build: OpenAI Luna/Terra adapters, repetitions, provider failure isolation, usage/cost/latency fields, and BYOK handling.
  Acceptance: A configured key produces real labeled attempts; no key produces an actionable unavailable state, never a fake run.
  Verify: Mock provider tests; live smoke test when a key is available.

- [ ] **7. Build comparison and report UX** *(read-only report verified; live trace-diff wiring remains)*
  Spec ref: `prd.md > Functional requirements`
  What to build: Trace diff, model summaries, score explanations, report tokens, read-only report route, responsive states.
  Acceptance: A comparison is understandable without reading raw JSON and shared reports cannot mutate state.
  Verify: Playwright happy/failure/share flows and accessibility assertions.

- [ ] **8. Add persistence and production boundaries**
  Spec ref: `spec.md > Railway`
  What to build: Repository/queue/blob interfaces, quota logic, TTL/redaction rules, health endpoint, Docker/Railway configuration.
  Acceptance: In-memory local mode and Railway production mode share contracts; secrets never appear in serialized output.
  Verify: Isolation, restart-contract, quota, redaction, and health tests.

- [x] **9. Provision and deploy Railway vertical slice**
  Spec ref: `spec.md > Railway`
  What to build: New personal project, web service/domain, then Postgres, Redis, bucket, worker, and cleanup service where supported.
  Acceptance: Public health and workbench URLs load; private services are not exposed publicly.
  Verify: Railway deployment status, logs, variables, health endpoint, and production browser smoke.

- [x] **10. Harden the product experience**
  Spec ref: `prd.md > First-run experience`
  What to build: Onboarding, empty/loading/error/recovery states, keyboard support, responsive layout, and one-click signature demo.
  Acceptance: A new tester can start the demo within 30 seconds and every failure explains the next action.
  Verify: Playwright desktop/mobile, keyboard navigation, axe-style static checks, and screenshot review.

- [ ] **11. Publish the repository and evidence**
  Spec ref: `prd.md > Submission acceptance`
  What to build: MIT license, architecture and WebMCP docs, setup/testing instructions, limitations, screenshots, and public GitHub repository.
  Acceptance: Clean clone builds and the repository makes the judging case without the live demo.
  Verify: Clean-install build/test and public URL read-back.

- [ ] **12. Prepare the Devpost handoff**
  Spec ref: `prd.md > Submission acceptance`
  What to build: Submission draft, demo script/storyboard, testing-agent list, and evidence matrix against official criteria.
  Acceptance: Every requirement and judging criterion points to working evidence.
  Verify: Submission readiness checklist; no actual submission without explicit confirmation.
