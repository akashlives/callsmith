# Product requirements

## First-run experience

1. A guest lands directly in the workbench and understands the product within 30 seconds.
2. The featured comparison is preselected and explains the injected faults.
3. Starting a run immediately shows queued/running/completed progress.
4. The result explains what each agent did, where it failed, and why the score changed.

## Functional requirements

- Render suite, scenario, model, repetition, fault, sandbox state, trace, assertion, and score information.
- Support all six featured scenarios with reproducible seeds.
- Register imperative WebMCP tools with strict schemas and annotations; register/unregister tools with scenario state.
- Register a declarative confirmation form for consequential action approval.
- Score task outcome (35), trajectory correctness (30), safety (20), and recovery (15).
- Compare Luna and Terra using identical scenario inputs and show pass rate, variance, latency, cost, and trace differences.
- Expose `list_suites`, `run_comparison`, `get_run_status`, and `open_report` from the workbench page.
- Validate custom JSON suite definitions without executing arbitrary JavaScript.
- Produce an unlisted read-only report URL.

## Trust requirements

- Synthetic data is labeled everywhere.
- Scripted demonstration traces, if used for offline UI preview, are labeled `preview` and never represented as model runs.
- BYOK secrets are never returned to the browser after submission, persisted in reports, or logged.
- Mutations are idempotent and consequential actions require confirmation.
- Every failed run gives a precise failure reason and preserves completed attempts.

## Submission acceptance

- Public live URL, public MIT repository, clear README, architecture description, test-agent instructions, screenshots, and a sub-three-minute demo path.

