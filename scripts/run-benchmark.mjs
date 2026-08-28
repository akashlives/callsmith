import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const baseUrl = (process.env.CALLSMITH_BENCHMARK_URL || "http://127.0.0.1:3000")
  .replace(/\/$/, "");
const token = process.env.CALLSMITH_RUNNER_TOKEN?.trim();
const output = resolve(
  process.env.CALLSMITH_BENCHMARK_OUTPUT || "outputs/benchmark-report.json",
);
const seeds = (process.env.CALLSMITH_BENCHMARK_SEEDS || "601,602,603,604,605,606,607,608,609,610")
  .split(",")
  .map((value) => Number(value.trim()));

if (!token) throw new Error("CALLSMITH_RUNNER_TOKEN is required");
if (seeds.some((seed) => !Number.isSafeInteger(seed))) {
  throw new Error("CALLSMITH_BENCHMARK_SEEDS must contain comma-separated integers");
}

async function json(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

const created = await json(
  await fetch(`${baseUrl}/api/internal/benchmarks`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ seeds }),
  }),
);

const deadline = Date.now() + 15 * 60_000;
const terminal = new Set(["completed", "partial_failure", "failed"]);
const statuses = new Map();
while (Date.now() < deadline && statuses.size < created.runs.length) {
  for (const run of created.runs) {
    if (statuses.has(run.id)) continue;
    const status = await json(
      await fetch(`${baseUrl}${run.statusPath}`, {
        headers: { authorization: `Bearer ${run.accessToken}` },
      }),
    );
    if (terminal.has(status.status)) statuses.set(run.id, status);
  }
  if (statuses.size < created.runs.length) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  }
}

const receipts = [];
const failures = [];
for (const failed of created.failedSeeds || []) failures.push(failed);
for (const run of created.runs) {
  const status = statuses.get(run.id);
  if (!status?.receiptAvailable) {
    failures.push({
      id: run.id,
      seed: run.seed,
      status: status?.status || "timeout",
      evidenceStatus: status?.evidenceStatus || "pending",
    });
    continue;
  }
  receipts.push(await json(await fetch(`${baseUrl}${run.receiptPath}`)));
}

// Keep the CLI independent of Next's private build output. The public receipt
// payloads contain all facts needed for the immutable benchmark artifact.
const z = 1.959963984540054;
const estimate = (successes, total) => {
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return { successes, total, rate: p, wilson95: { low: center - margin, high: center + margin } };
};
const complete = receipts.length;
const pairLatencies = receipts.map((receipt) =>
  Math.max(receipt.weak.latencyMs, receipt.hardened.latencyMs),
);
const percentile = (values, quantile) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(quantile * ordered.length) - 1)];
};
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  coverage: {
    expectedPairs: seeds.length,
    completedPairs: complete,
    failures,
  },
  rates: complete
    ? {
        officialBaselinePassedBoth: estimate(
          receipts.filter((receipt) =>
            receipt.weak.facts.officialExpectedCallBaseline === "pass" &&
            receipt.hardened.facts.officialExpectedCallBaseline === "pass",
          ).length,
          complete,
        ),
        baselineCallsmithDisagreement: estimate(
          receipts.filter((receipt) =>
            receipt.conclusion === "hardened_prevented_harm" &&
            receipt.weak.facts.officialExpectedCallBaseline === "pass" &&
            receipt.hardened.facts.officialExpectedCallBaseline === "pass",
          ).length,
          complete,
        ),
        weakUnsafeMutation: estimate(
          receipts.filter((receipt) => receipt.weak.facts.protectedState === "mutated").length,
          complete,
        ),
        hardenedHarmPrevention: estimate(
          receipts.filter((receipt) => receipt.hardened.facts.harmPrevention === "prevented").length,
          complete,
        ),
      }
    : {},
  latencyMs: complete
    ? {
        min: Math.min(...pairLatencies),
        median: percentile(pairLatencies, 0.5),
        p95: percentile(pairLatencies, 0.95),
        max: Math.max(...pairLatencies),
      }
    : null,
  receipts: receipts.map((receipt) => ({
    seed: receipt.seed,
    receiptId: receipt.receiptId,
    contentHash: receipt.contentHash,
    conclusion: receipt.conclusion,
    receiptPath: created.runs.find((run) => run.seed === receipt.seed)?.receiptPath,
    weak: receipt.weak.facts,
    hardened: receipt.hardened.facts,
    execution: receipt.weak.execution,
    framework: receipt.framework,
  })),
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ output, coverage: report.coverage, rates: report.rates }, null, 2)}\n`);
