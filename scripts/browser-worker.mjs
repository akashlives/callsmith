import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import Redis from "ioredis";

import {
  runBrowserEvaluation,
  webMcpRunnerIdentity,
} from "./lib/webmcp-evals-adapter.mjs";

const execFileAsync = promisify(execFile);
const jobStream = "callsmith:experiment-jobs:v1";
const workerGroup = "callsmith-browser-workers:v1";
const workerHeartbeat = "callsmith:browser-worker:v1:heartbeat";
const consumerName = `${process.env.RAILWAY_REPLICA_ID || hostname()}-${process.pid}`;
const redisUrl = process.env.REDIS_URL?.trim();
const runnerToken = process.env.CALLSMITH_RUNNER_TOKEN?.trim();
const webBase = (
  process.env.CALLSMITH_WEB_INTERNAL_URL ||
  process.env.CALLSMITH_PUBLIC_URL ||
  "http://web.railway.internal:3000"
).replace(/\/$/, "");
const sandboxBase = (process.env.CALLSMITH_PUBLIC_URL || webBase).replace(/\/$/, "");
const chromePath = "/usr/bin/google-chrome-unstable";
let draining = false;

if (!redisUrl) throw new Error("REDIS_URL is required by the Callsmith browser worker.");
if (!runnerToken) {
  throw new Error("CALLSMITH_RUNNER_TOKEN is required by the Callsmith browser worker.");
}

const redis = new Redis(redisUrl, {
  enableReadyCheck: true,
  maxRetriesPerRequest: null,
});

async function postEvent(event) {
  const response = await fetch(`${webBase}/api/internal/experiment-events`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${runnerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Web callback failed (${response.status}): ${body.slice(0, 400)}`);
  }
}

async function browserVersion() {
  const result = await execFileAsync(chromePath, ["--version"], { timeout: 10_000 });
  return result.stdout.trim() || "Google Chrome (version unavailable)";
}

async function hostedExperiment(experimentId) {
  const response = await fetch(
    `${webBase}/api/internal/experiments/${encodeURIComponent(experimentId)}/contract`,
    {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${runnerToken}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Unable to load queued experiment contract (${response.status}).`);
  }
  const body = await response.json();
  if (!body.experiment || !body.suite || !body.scenario) {
    throw new Error("Queued experiment contract is no longer hosted.");
  }
  return body;
}

async function dispatchPendingExperiments() {
  const response = await fetch(`${webBase}/api/internal/experiments/outbox`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${runnerToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Unable to read the experiment outbox (${response.status}).`);
  }
  const body = await response.json();
  const experimentIds = Array.isArray(body.experimentIds)
    ? body.experimentIds.filter((id) => typeof id === "string")
    : [];
  for (const experimentId of experimentIds) {
    const enqueuedAt = new Date().toISOString();
    await redis.xadd(
      jobStream,
      "*",
      "job",
      JSON.stringify({ schemaVersion: 1, experimentId, enqueuedAt }),
    );
    const marked = await fetch(`${webBase}/api/internal/experiments/outbox`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${runnerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ experimentId }),
    });
    if (!marked.ok) {
      throw new Error(`Unable to mark outbox delivery (${marked.status}).`);
    }
  }
}

function sandboxAccess(experimentId, attemptId) {
  const expiresAtMs = Date.now() + 5 * 60_000;
  const payload = `${experimentId}\n${attemptId}\n${expiresAtMs}`;
  return {
    expiresAtMs,
    signature: createHmac("sha256", runnerToken).update(payload).digest("hex"),
  };
}

function publicEvidenceUrl(url) {
  const sanitized = new URL(url);
  sanitized.searchParams.delete("run");
  sanitized.searchParams.delete("expires");
  sanitized.searchParams.delete("access");
  return sanitized.href;
}

function redactAccess(value, signature) {
  return signature ? value.replaceAll(signature, "[redacted-worker-access]") : value;
}

function expectedCalls(suite, scenario) {
  const calls = [];
  const names = new Set();
  const collect = (events) => {
    for (const event of events ?? []) {
      if (event?.type !== "tool_call" || typeof event.toolName !== "string") continue;
      if (names.has(event.toolName)) continue;
      names.add(event.toolName);
      calls.push({
        functionName: event.toolName,
        ...(event.args && typeof event.args === "object" ? { arguments: event.args } : {}),
      });
    }
  };
  collect(scenario.walkthroughs?.success);
  collect(scenario.walkthroughs?.failure);
  return calls;
}

async function executeAttempt(job, suite, scenario, model, contractVariant, seed) {
  const attemptKey = `${job.experimentId}-${contractVariant}-${model}-${seed}`;
  const sandboxUrl = new URL(
    `/sandbox/${encodeURIComponent(suite.id)}/${encodeURIComponent(scenario.id)}`,
    sandboxBase,
  );
  sandboxUrl.searchParams.set("contract", contractVariant);
  sandboxUrl.searchParams.set("seed", String(seed));
  sandboxUrl.searchParams.set("attempt", attemptKey);
  const access = sandboxAccess(job.experimentId, attemptKey);
  sandboxUrl.searchParams.set("run", job.experimentId);
  sandboxUrl.searchParams.set("expires", String(access.expiresAtMs));
  sandboxUrl.searchParams.set("access", access.signature);
  const workDir = await mkdtemp(join(tmpdir(), "callsmith-browser-"));
  const evalsPath = join(workDir, "evals.json");
  const outputDir = join(workDir, "reports");
  const startedAt = Date.now();
  const runner = await webMcpRunnerIdentity();

  try {
    await postEvent({
      type: "attempt_started",
      experimentId: job.experimentId,
      contractVariant,
    });
    await writeFile(
      evalsPath,
      JSON.stringify(
        [
          {
            name: `Callsmith ${contractVariant} safety contract`,
            messages: [
              { role: "user", type: "message", content: scenario.goal },
            ],
            expectedCall: expectedCalls(suite, scenario),
          },
        ],
        null,
        2,
      ),
      "utf8",
    );
    const execution = await runBrowserEvaluation({
      backend: "vercel",
      model: `openai:${model}`,
      maxSteps: 6,
      outputDir,
      chromeChannel: process.env.CALLSMITH_CHROME_CHANNEL || "chrome-dev",
      url: sandboxUrl.href,
      evalsPath,
      env: process.env,
    });
    await postEvent({
      type: "attempt",
      experimentId: job.experimentId,
      contractVariant,
      browserVersion: await browserVersion(),
      webMcpRunner: execution.runner,
      modelBackend: "vercel-openai",
      sandboxUrl: publicEvidenceUrl(sandboxUrl),
      latencyMs: Date.now() - startedAt,
      report: execution.report,
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    await postEvent({
      type: "failure",
      experimentId: job.experimentId,
      contractVariant,
      browserVersion: await browserVersion().catch(() => undefined),
      webMcpRunner: runner,
      modelBackend: "vercel-openai",
      sandboxUrl: publicEvidenceUrl(sandboxUrl),
      latencyMs: Date.now() - startedAt,
      error: redactAccess(rawMessage, access.signature).slice(0, 2_000),
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function processJob(rawJob) {
  const job = JSON.parse(rawJob);
  if (job.schemaVersion !== 1 || typeof job.experimentId !== "string") {
    throw new Error("Unsupported experiment stream job.");
  }
  const { experiment, suite, scenario } = await hostedExperiment(job.experimentId);
  if (
    experiment.receiptId &&
    ["completed", "partial_failure", "failed"].includes(experiment.status)
  ) {
    return;
  }
  await postEvent({ type: "started", experimentId: job.experimentId });
  const completed = new Set(
    (experiment.attempts ?? []).map((attempt) => attempt.contractVariant),
  );
  await Promise.all(
    ["weak", "hardened"].map(async (contractVariant) => {
      if (completed.has(contractVariant)) return;
      await executeAttempt(
        job,
        suite,
        scenario,
        experiment.model,
        contractVariant,
        experiment.seed,
      );
    }),
  );
  await postEvent({ type: "completed", experimentId: job.experimentId });
}

async function preserveJobFailure(rawJob, error) {
  let job;
  try {
    job = JSON.parse(rawJob);
  } catch {
    return true;
  }
  if (!job?.experimentId) return true;
  try {
    const { experiment } = await hostedExperiment(job.experimentId);
    const existing = new Set(
      (experiment.attempts ?? []).map((attempt) => attempt.contractVariant),
    );
    const runner = await webMcpRunnerIdentity();
    const message = error instanceof Error ? error.message : String(error);
    for (const contractVariant of ["weak", "hardened"]) {
      if (existing.has(contractVariant)) continue;
      await postEvent({
        type: "failure",
        experimentId: job.experimentId,
        contractVariant,
        webMcpRunner: runner,
        modelBackend: "vercel-openai",
        latencyMs: 0,
        error: `Browser worker job failed before this attempt completed: ${message}`.slice(
          0,
          2_000,
        ),
      });
    }
    await postEvent({ type: "completed", experimentId: job.experimentId });
    return true;
  } catch (preserveError) {
    const message =
      preserveError instanceof Error ? preserveError.message : String(preserveError);
    console.error(`[callsmith-worker] could not preserve job failure: ${message}`);
    return false;
  }
}

function jobFromFields(fields) {
  const index = fields.indexOf("job");
  if (index < 0 || typeof fields[index + 1] !== "string") {
    throw new Error("Experiment stream message has no job payload.");
  }
  return fields[index + 1];
}

async function ensureConsumerGroup() {
  try {
    await redis.xgroup("CREATE", jobStream, workerGroup, "0", "MKSTREAM");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("BUSYGROUP")) throw error;
  }
}

async function nextMessage() {
  const claimed = await redis.xautoclaim(
    jobStream,
    workerGroup,
    consumerName,
    60_000,
    "0-0",
    "COUNT",
    1,
  );
  const claimedMessages = Array.isArray(claimed?.[1]) ? claimed[1] : [];
  if (claimedMessages.length) return claimedMessages[0];
  const result = await redis.xreadgroup(
    "GROUP",
    workerGroup,
    consumerName,
    "COUNT",
    1,
    "BLOCK",
    5_000,
    "STREAMS",
    jobStream,
    ">",
  );
  return result?.[0]?.[1]?.[0];
}

async function heartbeat() {
  await redis.set(
    workerHeartbeat,
    JSON.stringify({ consumer: consumerName, at: new Date().toISOString(), draining }),
    "EX",
    30,
  );
}

async function main() {
  await ensureConsumerGroup();
  const engine = await webMcpRunnerIdentity();
  console.log(
    `[callsmith-worker] ready; consumer=${consumerName}; engine=${engine.name}@${engine.version}; browser=${await browserVersion()}`,
  );
  const heartbeatTimer = setInterval(() => {
    void heartbeat().catch((error) =>
      console.error(
        `[callsmith-worker] heartbeat failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }, 10_000);
  await heartbeat();
  while (!draining) {
    await dispatchPendingExperiments().catch((error) =>
      console.error(
        `[callsmith-worker] outbox dispatch failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
    const message = await nextMessage();
    if (!message) continue;
    const [messageId, fields] = message;
    const rawJob = jobFromFields(fields);
    let acknowledge = false;
    const leaseTimer = setInterval(() => {
      void redis
        .xclaim(jobStream, workerGroup, consumerName, 0, messageId, "JUSTID")
        .catch((error) =>
          console.error(
            `[callsmith-worker] lease renewal failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
    }, 20_000);
    try {
      await processJob(rawJob);
      acknowledge = true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[callsmith-worker] job failed: ${detail}`);
      acknowledge = await preserveJobFailure(rawJob, error);
    } finally {
      clearInterval(leaseTimer);
    }
    if (acknowledge) await redis.xack(jobStream, workerGroup, messageId);
  }
  clearInterval(heartbeatTimer);
  await heartbeat();
  await redis.quit();
}

process.on("SIGTERM", () => {
  draining = true;
  console.log("[callsmith-worker] draining current experiment before shutdown");
});
process.on("SIGINT", () => {
  draining = true;
});

await main();
