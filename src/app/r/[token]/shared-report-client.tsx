"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { buildCaseComparisonViewModel } from "@/components/case-comparison";
import {
  BenchmarkEvidence,
  ComparisonEvidence,
  OutcomeCards,
} from "@/components/comparison-evidence";
import { ThemeToggle } from "@/components/theme-toggle";
import { RunResultSchema, type RunResult } from "@/lib/contracts";

function decodeRunId(token: string): string | undefined {
  const encoded = token.split(".", 1)[0];
  if (!encoded) return undefined;
  try {
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  } catch {
    return undefined;
  }
}

export default function SharedReportClient({ token }: { token: string }) {
  const runId = useMemo(() => decodeRunId(token), [token]);
  const [run, setRun] = useState<RunResult>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    void fetch(
      `/api/runs/${encodeURIComponent(runId)}?shareToken=${encodeURIComponent(token)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("This report is unavailable or has expired.");
        setRun(RunResultSchema.parse(await response.json()));
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Report unavailable.");
        }
      });
    return () => controller.abort();
  }, [runId, token]);

  const visibleError = error ?? (runId ? undefined : "This report token is invalid.");

  if (visibleError) {
    return (
      <main className="report-shell report-shell--centered">
        <section className="report-message" role="alert">
          <span>Callsmith / report</span>
          <h1>Report unavailable</h1>
          <p>{visibleError}</p>
          <Link href="/">Return to Callsmith</Link>
        </section>
      </main>
    );
  }

  if (!run) {
    return (
      <main className="report-shell report-shell--centered">
        <section className="report-message" role="status">
          <span>Callsmith / report</span>
          <h1>Recovering evidence</h1>
          <p>Loading the immutable comparison from Callsmith.</p>
        </section>
      </main>
    );
  }

  const comparison = buildCaseComparisonViewModel(run);

  return (
    <main className="report-shell">
      <div className="report-wrap">
        <header className="report-nav">
          <Link href="/" className="site-brand" aria-label="Return to Callsmith">
            <span aria-hidden="true">C</span>
            <strong>Callsmith</strong>
          </Link>
          <ThemeToggle />
        </header>

        <section className="report-hero" aria-labelledby="report-heading">
          <div className="report-badges">
            <span>Read only</span>
            <span>{comparison.provenanceLabel}</span>
          </div>
          <p className="story-eyebrow">Reliability report · {run.scenarioId.replaceAll("-", " ")}</p>
          <h1 id="report-heading">{comparison.headline}</h1>
          <p>{comparison.summary}</p>
          <small>
            Synthetic sandbox evidence. This unlisted report contains no customer data,
            provider key, or mutable controls.
          </small>
        </section>

        {comparison.attempts.length ? (
          <>
            <OutcomeCards attempts={comparison.attempts} />

            {comparison.benchmarkStats ? (
              <BenchmarkEvidence stats={comparison.benchmarkStats} />
            ) : null}

            <section className="report-run-facts" aria-label="Run facts">
              <div><span>Status</span><strong>{run.status.replaceAll("_", " ")}</strong></div>
              <div><span>Assertions passed</span><strong>{comparison.passed}/{comparison.total}</strong></div>
              <div><span>Seed</span><strong>{comparison.seed}</strong></div>
              <div><span>Suite</span><strong>{run.suiteVersion}</strong></div>
            </section>

            <ComparisonEvidence
              attempts={comparison.attempts}
              summary="Inspect the immutable evidence"
            />
          </>
        ) : (
          <div className="report-empty">
            No completed attempt evidence is available. The run ended before browser or
            fallback evidence could be evaluated.
          </div>
        )}

        <footer className="report-footer">
          <Link href="/">Run the signature safety test</Link>
          <span>Callsmith · WebMCP reliability workbench</span>
        </footer>
      </div>
    </main>
  );
}
