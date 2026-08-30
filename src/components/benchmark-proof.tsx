import { Download } from "lucide-react";

import benchmark from "../../public/evidence/canonical-benchmark-v1.json";

function percentage(value: number) {
  return `${Math.round(value * 100)}%`;
}

function interval(value: { low: number; high: number }) {
  return `${(value.low * 100).toFixed(1)}–${(value.high * 100).toFixed(1)}%`;
}

const rows = [
  {
    label: "Expected calls passed both contracts",
    result: benchmark.rates.officialBaselinePassedBoth,
    meaning: "The conventional matcher accepted both website contracts.",
  },
  {
    label: "Callsmith found a material difference",
    result: benchmark.rates.baselineCallsmithDisagreement,
    meaning: "Browser state exposed a safety outcome the call matcher missed.",
  },
  {
    label: "Weak contract mutated protected state",
    result: benchmark.rates.weakUnsafeMutation,
    meaning: "The consequential action reached the synthetic record.",
  },
  {
    label: "Hardened contract prevented harm",
    result: benchmark.rates.hardenedHarmPrevention,
    meaning: "The browser boundary preserved protected state.",
  },
] as const;

const decisivePairs = benchmark.rates.baselineCallsmithDisagreement;
const benchmarkExecution = benchmark.receipts[0]?.execution;

export function BenchmarkProof() {
  return (
    <section className="benchmark-evidence" id="evidence" aria-labelledby="benchmark-heading">
      <div>
        <p className="story-eyebrow">Immutable benchmark · 20 browser attempts</p>
        <h2 id="benchmark-heading">
          {decisivePairs.successes} of {decisivePairs.total} matched pairs exposed what
          expected-call checks missed.
        </h2>
        <p>
          Ten fixed seeds ran the same Luna task against weak and hardened WebMCP
          contracts. Every seed and failure is retained; results are never removed to
          improve the headline.
        </p>
      </div>

      <div className="benchmark-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Observed fact</th>
              <th scope="col">Result</th>
              <th scope="col">Wilson 95% interval</th>
              <th scope="col">Interpretation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{row.result.successes}/{row.result.total} · {percentage(row.result.rate)}</td>
                <td>{interval(row.result.wilson95)}</td>
                <td>{row.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="benchmark-evidence__footer">
        <p>
          Median pair latency {benchmark.latencyMs.median.toLocaleString()} ms · {benchmarkExecution?.browserVersion ?? "Browser unavailable"} · {benchmarkExecution ? `${benchmarkExecution.webMcpRunner}@${benchmarkExecution.webMcpRunnerVersion}` : "Runner unavailable"} · {benchmark.coverage.failures.length === 0 ? "zero missing pairs" : `${benchmark.coverage.failures.length} missing pairs`}
        </p>
        <a href="/evidence/canonical-benchmark-v1.json" download>
          <Download size={15} aria-hidden="true" /> Download benchmark JSON
        </a>
      </div>
    </section>
  );
}
