# Railway opportunity map for Callsmith

This is a product-driven adoption map, not an invitation to add infrastructure
for its own sake. A Railway feature enters the submission lane only when it
improves evidence integrity, runner reliability, security, judge experience, or
community adoption.

## Already used

- Isolated staging and production environments.
- Public web service plus private worker, Postgres, Redis, and object bucket.
- Redis-backed durable browser queue and Postgres-backed immutable reports and
  unlisted suites.
- Railway CLI and agent skill for target-verified deploys, bounded logs, and
  release inspection.

## Submission-critical pull-forward

1. **Healthcheck-gated deploys and graceful teardown.** Configure `/api/health`
   for the web service, add overlap/draining for in-flight SSE and report reads,
   and give the worker enough drain time to return a leased job to Redis.
2. **Private evidence artifacts.** Wire browser screenshots, normalized traces,
   and immutable benchmark bundles to the existing environment-isolated bucket;
   serve them only through authorization checks or short-lived presigned URLs.
3. **Environment-scoped observability.** Build Railway dashboards for web HTTP
   errors/latency, worker CPU/RAM/crashes, Redis queue depth, and Postgres health.
   Add monitors and deployment/crash webhooks before the final browser gate.
4. **Cleanup as a real Railway cron.** Deploy the existing cleanup service as an
   exit-on-completion cron for expired drafts, ephemeral secrets, stale runs,
   and orphaned artifacts. Keep queue retry/recovery in the worker, not cron.
5. **Database recovery.** Enable scheduled Postgres volume backups and record a
   restore drill. Add PITR only when judging data becomes valuable enough to
   justify the extra bucket and operational surface.
6. **Infrastructure as code.** Migrate the legacy `railway.toml` to Railway's
   current `.railway/railway.ts` infrastructure format before the documented
   December 2026 config-as-code cutoff. Capture service topology, healthchecks,
   references, cron, and environment differences without storing secrets.

## Adoption multiplier after the core gates

- Publish a one-click Callsmith Railway template after external testers prove
  the authoring flow. It can package web, worker, Postgres, Redis, bucket, and
  generated reference variables, turning Railway's template marketplace into a
  concrete community-distribution channel.
- Enable focused PR environments once GitHub delivery is part of the release
  path. They can give contributed gauntlets isolated browser QA without sharing
  production state or bucket credentials.
- Keep Railway's MCP/agent tooling in the maintainer workflow for scoped deploys,
  logs, metrics, and recovery. It is an operations advantage, not a substitute
  for Callsmith's own WebMCP product tools.

## Deliberately deferred

- Multi-region replicas and Postgres HA are premature before browser-run
  latency, queue recovery, and evidence correctness are proven at hackathon
  traffic levels.
- Railway Functions would duplicate code already shared by the web, worker, and
  cleanup service; use the repo-backed cron unless a truly isolated webhook
  handler appears.
- A public bucket is neither available nor desirable for unlisted evidence.

## Primary Railway references

- [Environments and PR environments](https://docs.railway.com/environments)
- [Private storage buckets](https://docs.railway.com/storage-buckets)
- [Observability dashboards, monitors, and webhooks](https://docs.railway.com/observability)
- [Healthchecks](https://docs.railway.com/deployments/healthchecks)
- [Deployment overlap and draining](https://docs.railway.com/deployments/deployment-teardown)
- [Cron jobs](https://docs.railway.com/cron-jobs)
- [Postgres backups and restore drills](https://docs.railway.com/guides/postgres-backups-restores)
- [Railway for agents](https://docs.railway.com/agents)
- [Templates and open-source distribution](https://docs.railway.com/templates)
- [Config-as-code deprecation](https://docs.railway.com/config-as-code)
