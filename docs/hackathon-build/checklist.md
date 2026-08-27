# Callsmith ruthless win-first checklist

The gate is not “the dashboard works.” The gate is one browser-native result
where the ordinary expected-call baseline passes while Callsmith catches an
unsafe state transition.

## 1. Remove benchmark theater

- [x] Replace scenario coaching with the neutral `webmcp-evals@0.0.3` agent policy.
- [x] Enforce hardened confirmation inside the browser WebMCP tool.
- [x] Score task completion, unsafe attempt, unsafe mutation, and prevented harm separately.
- [x] Migrate provenance to `browser_webmcp`, `server_simulation`, and `deterministic_preview`.
- [x] Keep old persisted reports readable through contract preprocessing.
- [x] Replace the cartoon attack string with a plausible meeting handoff note.

Gate: the expected trajectory cannot be read from the agent instructions, and
no non-browser trace is labeled as browser WebMCP evidence.

## 2. Execute through the real browser surface

- [x] Pin and invoke the official `webmcp-evals@0.0.3` browser CLI.
- [x] Launch Chrome unstable with `--enable-features=WebMCP` in a dedicated Railway worker.
- [x] Execute tools through `document.modelContext.getTools()` and `executeTool()`.
- [x] Queue jobs durably with Redis `BRPOPLPUSH`; recover processing jobs on worker start.
- [x] Post signed browser evidence to the private web service callback.
- [x] Capture browser tool calls, results, confirmation requests, blocks, state snapshots,
  browser version, model/backend, suite version, seed, contract, engine, and latency.
- [x] Preserve browser launch/provider failures as partial evidence.
- [x] Reproduce a complete browser-native production run from the checked-in command.
- [x] Interrupt and restart a claimed job, then verify Redis recovery finishes the run.

Gate: the production trace proves registration and mutation inside the sandbox
page. A server-side action emulator cannot satisfy this gate.

## 3. Produce the decisive demonstration

- [x] Run the same model, task, seed, hostile content, and neutral policy against weak and hardened contracts.
- [x] Keep the official expected-call result beside Callsmith’s state-and-safety verdict.
- [x] Make contract comparison primary; move model comparison into developer evidence.
- [x] Show task completion, unsafe attempt, and harm prevention as separate outcomes.
- [x] Add per-contract rates, Wilson 95% confidence intervals, and p50/p95 latency for immutable benchmarks.
- [x] Record a production weak-contract baseline pass plus Callsmith unsafe-mutation failure.
- [x] Record ten benchmark attempts per contract, preserving one provider failure on each side.
- [x] Share the immutable benchmark report and verify it opens without login.

Gate: a reviewer can attribute the difference to website contract design, not a
different prompt, model, task, or seed.

Production run identifiers, report links, distributions, and known limitations
are recorded in [`ruthless-evidence.md`](ruthless-evidence.md).

## 4. Prove another developer can use it

- [x] Publish the versioned JSON-only suite format and safe action DSL.
- [x] Add `POST /api/suites` import and actionable validation errors.
- [x] Reject executable/arbitrary suite content through strict schemas.
- [x] Add the non-sales Support Escalation starter.
- [x] Generate the worker’s ordinary baseline from suite walkthroughs instead of sales-specific code.
- [x] Cover import, run, share, redaction, report, and WebMCP orchestration paths with automated tests.
- [ ] Make imported suites durable across web-process restarts.
- [ ] Complete five external comprehension tests.
- [ ] Receive one independent suite contribution or pull request.
- [ ] Capture supported-browser discovery and the sub-three-minute demo video.

Gate: an outside developer creates and runs a useful gauntlet from the docs
without changing Callsmith application code.

## Verification commands

```bash
npm run typecheck
npm run lint -- --quiet
npm test
npm run build
npm run test:e2e
```

## Ruthless exclusions

Until the browser and decisive-demo gates are closed: no more dashboard UI,
GitHub auth, arbitrary-site crawling, generic LLM graders, providers, or SOTA
claims.
