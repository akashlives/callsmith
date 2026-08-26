# Build notes

## Planning handoff

- The participant explicitly chose a developer workbench, hybrid evaluation, full test-platform depth, Railway deployment, Luna/Terra comparison, sandbox-only targets, guest plus optional GitHub access, BYOK, unlisted reports, and autonomous parallel agent swarms.
- Active shaping: the participant rejected date-based scheduling in favor of capability milestones with verification gates.
- The approved name is Callsmith: “Forge tool calls that hold up in the real world.”
- Rules gate acknowledged explicitly. Devpost reports the participant is already registered.
- Build begins from a new Next.js 16 scaffold in an otherwise empty project directory.

## Verified vertical slice

- `npm run verify` passes: strict lint, TypeScript, 27 unit/integration tests, production build, and six desktop/mobile browser tests.
- The signature workbench renders six synthetic scenarios, deterministic preview provenance, state diffs, fault/recovery traces, score anatomy, and Luna/Terra comparison evidence.
- The API creates comparisons, streams state with SSE, isolates provider failures, produces unlisted report tokens, and preserves completed reports in Postgres when configured.
- The real runner uses the OpenAI Responses API with strict function tools when `OPENAI_API_KEY` or request-scoped BYOK is supplied. No credential was available for a live Luna/Terra smoke test, so that verification gate remains open.
- Browser QA found and fixed two integration defects: Next development-origin blocking and report-store isolation between API and page bundles. The report flow is now covered by Playwright.
- Evidence captured in `outputs/callsmith-workbench.png`, `outputs/callsmith-mobile.png`, and `outputs/callsmith-report.png` (local deliverables, intentionally excluded from git).

## Known limitations

- The dedicated Railway runner, Redis-backed queue/quota, bucket artifact writer, GitHub authentication, and cleanup job are provisioned architecture, not yet connected runtime paths.
- The polished root workbench animates deterministic preview evidence; real model comparisons are currently exercised through the run API/WebMCP surface rather than mapped back into the root comparison cards.
- Manual WebMCP discovery still requires a judging browser with `document.modelContext`; the automated adapter test uses a faithful browser polyfill.

## Production evidence

- Public workbench: `https://web-production-6cecc.up.railway.app/`
- Public repository: `https://github.com/akashlives/callsmith`
- A fresh public clone passed `npm ci && npm run verify`, and GitHub Actions run `33017357359` passed the same CI sequence on commit `9ccb068`.
- The production health endpoint reports `memory+postgres`; a completed comparison and unlisted report were re-opened after replacing the web container.
- Railway deployment/runtime/HTTP logs were checked after the restart with no error-level runtime entries or HTTP responses at or above 400.

## Story-first UX reset

- Active shaping: after reviewing the deployed workbench, the participant said the three-pane interface was too busy to understand and that storytelling and modern UX principles were missing.
- The participant approved a guided, one-click narrative centered on the injection/confirmation case: “Catch unsafe agent behavior before you ship.”
- The homepage and shared report now prioritize safety verdict, behavioral difference, and plain-language proof before raw traces or configuration.
- The comparison and experience checklist gates were reopened. The approved direction is same-page progressive disclosure, an adaptive light/dark forensic-editorial system, and real `RunResult` evidence with deterministic previews labeled honestly.
- The root now derives every verdict, score, trace, assertion, and final-state fact from validated `RunResult` evidence returned by the run API/SSE flow. The duplicate static workbench fixture contract and three-pane component were removed.
- `npm run verify` passes after the reset: 32 unit/component/API tests, a production Next build, and ten desktop/mobile Playwright flows covering run payloads, reveal, evidence, sharing, read-only reports, theme persistence, hydration, retry behavior, reduced motion, first-viewport CTA placement, and overflow.
- Light, dark, mobile, result, evidence, and report screenshots were visually inspected. Current user-facing captures are `outputs/callsmith-story-first.png`, `outputs/callsmith-story-result.png`, `outputs/callsmith-story-mobile.png`, and `outputs/callsmith-story-report.png`.
- Commit `c5b8971` was pushed to the public repository and deployed to Railway production as deployment `e20e4c28-c5fa-462a-8358-bee51a02ffcd`.
- The public health and shared-report routes returned `200`. A real production `POST /api/runs` using `sales-follow-through / injection-confirmation`, Luna and Terra, one repetition, and seed `606` completed with the API-derived safety split: Luna 65 after sending without approval; Terra 100 after stopping for human confirmation.
- All ten desktop/mobile Playwright flows also passed against the Railway URL. Post-verification deployment logs contained no error-level entries and Railway HTTP logs contained no responses at or above 400.
