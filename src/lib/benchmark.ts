import type { EvidenceReceiptV1 } from "@/lib/evidence-receipt";

export type RateEstimate = {
  successes: number;
  total: number;
  rate: number;
  wilson95: { low: number; high: number };
};

export function wilsonInterval(successes: number, total: number) {
  if (!Number.isInteger(successes) || !Number.isInteger(total)) {
    throw new Error("Wilson interval counts must be integers");
  }
  if (total < 1 || successes < 0 || successes > total) {
    throw new Error("Wilson interval counts are out of range");
  }
  const z = 1.959963984540054;
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (proportion + (z * z) / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt(
      (proportion * (1 - proportion)) / total +
        (z * z) / (4 * total * total),
    );
  return {
    low: successes === 0 ? 0 : Math.max(0, center - margin),
    high: successes === total ? 1 : Math.min(1, center + margin),
  };
}

function rate(successes: number, total: number): RateEstimate {
  return {
    successes,
    total,
    rate: successes / total,
    wilson95: wilsonInterval(successes, total),
  };
}

function percentile(values: number[], quantile: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(quantile * ordered.length) - 1),
  );
  return ordered[index];
}

export function buildBenchmarkReport(
  receipts: EvidenceReceiptV1[],
  expectedSeeds: number[],
) {
  if (expectedSeeds.length < 1) throw new Error("Benchmark requires at least one seed");
  const uniqueSeeds = new Set(expectedSeeds);
  if (uniqueSeeds.size !== expectedSeeds.length) {
    throw new Error("Benchmark seeds must be unique");
  }
  const matching = receipts.filter((receipt) => uniqueSeeds.has(receipt.seed));
  const seenReceiptSeeds = new Set<number>();
  for (const receipt of matching) {
    if (seenReceiptSeeds.has(receipt.seed)) {
      throw new Error(`Benchmark contains duplicate receipt seed ${receipt.seed}`);
    }
    seenReceiptSeeds.add(receipt.seed);
  }
  const total = matching.length;
  if (total < 1) throw new Error("Benchmark has no completed matched pairs");

  const baselinePassedBoth = matching.filter(
    (receipt) =>
      receipt.weak.facts.officialExpectedCallBaseline === "pass" &&
      receipt.hardened.facts.officialExpectedCallBaseline === "pass",
  ).length;
  const weakMutated = matching.filter(
    (receipt) => receipt.weak.facts.protectedState === "mutated",
  ).length;
  const hardenedPrevented = matching.filter(
    (receipt) => receipt.hardened.facts.harmPrevention === "prevented",
  ).length;
  const decisiveDisagreement = matching.filter(
    (receipt) =>
      receipt.conclusion === "hardened_prevented_harm" &&
      receipt.weak.facts.officialExpectedCallBaseline === "pass" &&
      receipt.hardened.facts.officialExpectedCallBaseline === "pass",
  ).length;
  const pairLatencies = matching.map((receipt) =>
    Math.max(receipt.weak.latencyMs, receipt.hardened.latencyMs),
  );

  return {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    coverage: {
      expectedPairs: expectedSeeds.length,
      completedPairs: total,
      missingSeeds: expectedSeeds.filter((seed) => !seenReceiptSeeds.has(seed)),
    },
    rates: {
      officialBaselinePassedBoth: rate(baselinePassedBoth, total),
      weakUnsafeMutation: rate(weakMutated, total),
      hardenedHarmPrevention: rate(hardenedPrevented, total),
      baselineCallsmithDisagreement: rate(decisiveDisagreement, total),
    },
    latencyMs: {
      min: Math.min(...pairLatencies),
      median: percentile(pairLatencies, 0.5),
      p95: percentile(pairLatencies, 0.95),
      max: Math.max(...pairLatencies),
    },
    receipts: matching
      .sort((left, right) => left.seed - right.seed)
      .map((receipt) => ({
        receiptId: receipt.receiptId,
        seed: receipt.seed,
        contentHash: receipt.contentHash,
        conclusion: receipt.conclusion,
        weak: receipt.weak.facts,
        hardened: receipt.hardened.facts,
        framework: receipt.framework,
        execution: {
          browser: receipt.weak.execution.browserVersion,
          runner: `${receipt.weak.execution.webMcpRunner}@${receipt.weak.execution.webMcpRunnerVersion}`,
          model: receipt.weak.execution.model,
          backend: receipt.weak.execution.backend,
        },
      })),
  };
}
