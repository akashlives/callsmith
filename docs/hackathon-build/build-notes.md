# Build notes

## Planning handoff

- The participant explicitly chose a developer workbench, hybrid evaluation, full test-platform depth, Railway deployment, Luna/Terra comparison, sandbox-only targets, guest plus optional GitHub access, BYOK, unlisted reports, and autonomous parallel agent swarms.
- Active shaping: the participant rejected date-based scheduling in favor of capability milestones with verification gates.
- The approved name is Callsmith: “Forge tool calls that hold up in the real world.”
- Rules gate acknowledged explicitly. Devpost reports the participant is already registered.
- Build begins from a new Next.js 16 scaffold in an otherwise empty project directory.

## Verified vertical slice

- `npm run verify` passes: strict lint, TypeScript, 26 unit/integration tests, production build, and six desktop/mobile browser tests.
- The signature workbench renders six synthetic scenarios, deterministic preview provenance, state diffs, fault/recovery traces, score anatomy, and Luna/Terra comparison evidence.
- The API creates comparisons, streams state with SSE, isolates provider failures, produces unlisted report tokens, and preserves completed reports in Postgres when configured.
- The real runner uses the OpenAI Responses API with strict function tools when `OPENAI_API_KEY` or request-scoped BYOK is supplied. No credential was available for a live Luna/Terra smoke test, so that verification gate remains open.
- Browser QA found and fixed two integration defects: Next development-origin blocking and report-store isolation between API and page bundles. The report flow is now covered by Playwright.
- Evidence captured in `outputs/callsmith-workbench.png`, `outputs/callsmith-mobile.png`, and `outputs/callsmith-report.png` (local deliverables, intentionally excluded from git).

## Known limitations

- The dedicated Railway runner, Redis-backed queue/quota, bucket artifact writer, GitHub authentication, and cleanup job are provisioned architecture, not yet connected runtime paths.
- The polished root workbench animates deterministic preview evidence; real model comparisons are currently exercised through the run API/WebMCP surface rather than mapped back into the root comparison cards.
- Manual WebMCP discovery still requires a judging browser with `document.modelContext`; the automated adapter test uses a faithful browser polyfill.
