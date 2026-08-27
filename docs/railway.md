# Railway deployment

## Resolved production project

- Workspace: `akashlives's Projects` (`96a6e88e-afa8-40b4-856c-7b2cb66cbb58`)
- Project: `callsmith` (`6d81d9ea-a95c-492b-9f41-9067f0f6e20b`)
- Environment: `production` (`c9c9ebaf-080d-453c-9815-2e003b4b1d16`)
- Web: `e1203715-4602-4a67-8000-9e92b663460e`
- Runner: `a93d6544-4224-4ec6-b019-065b3b5566c1`
- Cleanup: `11bf96fc-91f5-4062-b013-2aa3e772810b`
- Postgres: `c1ff8162-6fee-4d28-bc07-28e4f996bdbf`
- Redis: `134f0e7f-e2f8-40a8-b0f3-d27ab2a76ffa`
- Artifact bucket: `callsmith-artifacts` (`aa7ded94-82a1-489a-a261-e889caa2fce0`), region `iad`

## Boundary

Only the web service receives a public domain. References from web and runner use Railway service variables (`${{Postgres.DATABASE_URL}}` and `${{Redis.REDIS_URL}}`) so traffic stays on the project-private network.

The bucket is private. Reports use opaque application routes; artifact downloads should be proxied or use short-lived presigned URLs.

## Release verification

1. Run `npm run verify` locally.
2. Resolve and print exact Railway target IDs before deploying.
3. Deploy the web service from the repository root.
4. Confirm the deployment is `SUCCESS` and inspect bounded build/runtime logs.
5. Check `/api/health`, the workbench, a run result, and a read-only report.

## Verified release evidence

- Public URL: `https://web-production-6cecc.up.railway.app/`
- Initial verified deployment: `740b8ede-5bc5-4b90-b213-1e71483abab6` (`SUCCESS`)
- Restart verification deployment: `91cb38e7-1c72-4819-8251-b171f17000d6` (`SUCCESS`)
- Health response: `status=ok`, `service=callsmith-web`, `persistence=memory+postgres`
- Production comparison: `run-a67b6043-358b-4ab1-a407-618ce75ec869`, two completed preview attempts
- Persistence gate: the existing share token and both attempts were recovered from Postgres after the web container was replaced.
- Browser gate: the recovered report rendered 65/100 vs 100/100 evidence with zero browser-console errors.
- Runtime gate: bounded Railway runtime and HTTP scans returned no error-level logs and no responses at or above 400 after verification.
- Live-model activation deployment: `f02d1282-cef3-424e-ac49-2c2e68f1723e` (`SUCCESS`), with `modelRunnerConfigured=true`.
- Grounded live-scenario deployment: `b3650716-8ed1-48d7-a0b6-57d5f6a58761` (`SUCCESS`).
- Verified live comparison: `run-6266e5b2-671f-4ab4-a0de-bd16879dc2fc`; Luna 100/100 in 14.9 seconds and Terra 100/100 in 17.2 seconds.
- Read-only live report: `/r/cnVuLTYyNjZlNWIyLTY3MWYtNGFiNC1hMGRlLWJkMTY4NzlkYzJmYw.4cf78839f7ad426a844a245580b83b8f`.

`OPENAI_API_KEY` is stored only as a sealed Railway variable on the production web service. The browser receives only a configuration boolean and validated run evidence; the key is not included in source, reports, analytics, or logs. Deterministic preview remains available with explicit preview provenance.
