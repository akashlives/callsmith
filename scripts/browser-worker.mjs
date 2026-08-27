import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import Redis from "ioredis";

const execFileAsync = promisify(execFile);
const pendingQueue = "callsmith:browser-runs:pending";
const processingQueue = "callsmith:browser-runs:processing";
const redisUrl = process.env.REDIS_URL?.trim();
const runnerToken = process.env.CALLSMITH_RUNNER_TOKEN?.trim();
const webBase = (
  process.env.CALLSMITH_WEB_INTERNAL_URL ||
  process.env.CALLSMITH_PUBLIC_URL ||
  "http://web.railway.internal:3000"
).replace(/\/$/, "");
const sandboxBase = (process.env.CALLSMITH_PUBLIC_URL || webBase).replace(/\/$/, "");
const cliPath = resolve("node_modules/webmcp-evals/dist/bin/webmcp-evals.js");
const chromePath = "/usr/bin/google-chrome-unstable";

if (!redisUrl) throw new Error("REDIS_URL is required by the Callsmith browser worker.");
if (!runnerToken) {
  throw new Error("CALLSMITH_RUNNER_TOKEN is required by the Callsmith browser worker.");
}

const redis = new Redis(redisUrl, {
  enableReadyCheck: true,
  maxRetriesPerRequest: null,
});

async function postEvent(event) {
  const response = await fetch(`${webBase}/api/internal/browser-results`, {
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
  const result = await execFileAsync(chromePath, ["--version"], {
    timeout: 10_000,
  });
  return result.stdout.trim() || "Google Chrome unstable (version unavailable)";
}

async function hostedScenario(suiteId, scenarioId) {
  const response = await fetch(`${webBase}/api/suites`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Unable to load hosted suites (${response.status}).`);
  const body = await response.json();
  const suite = body.suites?.find((candidate) => candidate.id === suiteId);
  const scenario = suite?.scenarios?.find((candidate) => candidate.id === scenarioId);
  if (!suite || !scenario) throw new Error("Queued suite or scenario is no longer hosted.");
  return { suite, scenario };
}

async function completedAttemptKeys(runId) {
  const response = await fetch(`${webBase}/api/runs/${encodeURIComponent(runId)}`);
  if (!response.ok) throw new Error(`Unable to load queued run state (${response.status}).`);
  const run = await response.json();
  return new Set(
    (run.attempts ?? []).map(
      (attempt) => `${attempt.contractVariant}:${attempt.model}:${attempt.seed}`,
    ),
  );
}

function expectedCalls(suite, scenario) {
  const calls = [];
  const names = new Set();
  const collect = (events) => {
    for (const event of events ?? []) {
      if (event?.type !== "tool_call" || typeof event.toolName !== "string") continue;
      if (names.has(event.toolName)) continue;
      names.add(event.toolName);
      const definition = suite.tools?.find((tool) => tool.name === event.toolName);
      calls.push({
        functionName: event.toolName,
        ...(definition?.annotations?.readOnlyHint &&
        event.args &&
        typeof event.args === "object"
          ? { arguments: event.args }
          : {}),
      });
    }
  };

  // Start with the useful task trajectory, then add any consequential call
  // that appears only in the unsafe walkthrough. This keeps the official
  // expected-call baseline suite-defined instead of sales-specific.
  collect(scenario.walkthroughs?.success);
  collect(scenario.walkthroughs?.failure);
  const firstMutation = calls.findIndex((call) => {
    const definition = suite.tools?.find((tool) => tool.name === call.functionName);
    return definition && !definition.annotations?.readOnlyHint;
  });
  const optionalReads = (suite.tools ?? [])
    .filter(
      (tool) =>
        scenario.enabledTools?.includes(tool.name) &&
        tool.annotations?.readOnlyHint &&
        !names.has(tool.name),
    )
    .map((tool) => ({ functionName: tool.name, optional: true }));
  calls.splice(firstMutation < 0 ? calls.length : firstMutation, 0, ...optionalReads);
  return calls;
}

async function executeAttempt(job, suite, scenario, model, contractVariant, seed) {
  const attemptKey = `${job.runId}-${contractVariant}-${model}-${seed}`;
  const sandboxUrl = new URL(
    `/sandbox/${encodeURIComponent(suite.id)}/${encodeURIComponent(scenario.id)}`,
    sandboxBase,
  );
  sandboxUrl.searchParams.set("contract", contractVariant);
  sandboxUrl.searchParams.set("seed", String(seed));
  sandboxUrl.searchParams.set("attempt", attemptKey);
  const workDir = await mkdtemp(join(tmpdir(), "callsmith-browser-"));
  const evalsPath = join(workDir, "evals.json");
  const outputDir = join(workDir, "reports");
  const startedAt = Date.now();

  try {
    await writeFile(
      evalsPath,
      JSON.stringify(
        [
          {
            name: `Callsmith ${contractVariant} contract safety case`,
            messages: [
              {
                role: "user",
                type: "message",
                content: scenario.goal,
              },
            ],
            expectedCall: expectedCalls(suite, scenario),
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    await execFileAsync(
      process.execPath,
      [
        cliPath,
        "--backend",
        "vercel",
        "--model",
        `openai:${model}`,
        "--runs",
        "1",
        "--max-steps",
        "6",
        "--reporter",
        "json",
        "--output-dir",
        outputDir,
        "browser",
        "--url",
        sandboxUrl.href,
        "--evals",
        evalsPath,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: 150_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );

    const reports = (await readdir(outputDir))
      .filter((name) => name.endsWith(".json"))
      .sort();
    const reportName = reports.at(-1);
    if (!reportName) throw new Error("webmcp-evals produced no JSON report.");
    const report = JSON.parse(await readFile(join(outputDir, reportName), "utf8"));
    await postEvent({
      type: "attempt",
      runId: job.runId,
      model,
      seed,
      contractVariant,
      browserVersion: await browserVersion(),
      sandboxUrl: sandboxUrl.href,
      latencyMs: Date.now() - startedAt,
      report,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await postEvent({
      type: "failure",
      runId: job.runId,
      model,
      seed,
      contractVariant,
      browserVersion: await browserVersion().catch(() => undefined),
      sandboxUrl: sandboxUrl.href,
      latencyMs: Date.now() - startedAt,
      error: message.slice(0, 2_000),
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function processJob(rawJob) {
  const job = JSON.parse(rawJob);
  if (job.schemaVersion !== 1 || job.input?.provenance !== "browser_webmcp") {
    throw new Error("Unsupported browser queue job.");
  }
  await postEvent({ type: "started", runId: job.runId });
  const { suite, scenario } = await hostedScenario(job.input.suiteId, job.input.scenarioId);
  const completed = await completedAttemptKeys(job.runId);
  for (const model of job.input.models) {
    for (let repetition = 0; repetition < job.input.repetitions; repetition += 1) {
      const seed = job.input.seed + repetition;
      await Promise.all(
        job.input.contractVariants.map(async (contractVariant) => {
          const attemptKey = `${contractVariant}:${model}:${seed}`;
          if (completed.has(attemptKey)) return;
          await executeAttempt(job, suite, scenario, model, contractVariant, seed);
          completed.add(attemptKey);
        }),
      );
    }
  }
  await postEvent({ type: "completed", runId: job.runId });
}

async function preserveJobFailure(rawJob, error) {
  let job;
  try {
    job = JSON.parse(rawJob);
  } catch {
    return;
  }
  if (!job?.runId || !job?.input) return;

  try {
    const response = await fetch(`${webBase}/api/runs/${encodeURIComponent(job.runId)}`);
    const current = response.ok ? await response.json() : { attempts: [] };
    const existing = new Set(
      (current.attempts ?? []).map(
        (attempt) => `${attempt.contractVariant}:${attempt.model}:${attempt.seed}`,
      ),
    );
    const message = error instanceof Error ? error.message : String(error);
    for (const contractVariant of job.input.contractVariants ?? []) {
      for (const model of job.input.models ?? []) {
        for (let repetition = 0; repetition < (job.input.repetitions ?? 1); repetition += 1) {
          const seed = job.input.seed + repetition;
          if (existing.has(`${contractVariant}:${model}:${seed}`)) continue;
          await postEvent({
            type: "failure",
            runId: job.runId,
            model,
            seed,
            contractVariant,
            latencyMs: 0,
            error: `Browser worker job failed before this attempt completed: ${message}`.slice(
              0,
              2_000,
            ),
          });
        }
      }
    }
    await postEvent({ type: "completed", runId: job.runId });
  } catch (preserveError) {
    const message = preserveError instanceof Error ? preserveError.message : String(preserveError);
    console.error(`[callsmith-worker] could not preserve job failure: ${message}`);
  }
}

async function recoverInterruptedJobs() {
  const interrupted = await redis.lrange(processingQueue, 0, -1);
  for (const rawJob of interrupted) {
    await redis.lpush(pendingQueue, rawJob);
    await redis.lrem(processingQueue, 1, rawJob);
  }
}

async function main() {
  await recoverInterruptedJobs();
  console.log(
    `[callsmith-worker] ready; engine=webmcp-evals@0.0.3; browser=${await browserVersion()}`,
  );
  for (;;) {
    const rawJob = await redis.brpoplpush(pendingQueue, processingQueue, 0);
    if (!rawJob) continue;
    try {
      await processJob(rawJob);
      await redis.lrem(processingQueue, 1, rawJob);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[callsmith-worker] job failed: ${message}`);
      await preserveJobFailure(rawJob, error);
      await redis.lrem(processingQueue, 1, rawJob);
    }
  }
}

await main();
