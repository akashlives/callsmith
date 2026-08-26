"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { RunResult } from "@/lib/contracts";

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

function formatModel(model: string) {
  if (model === "gpt-5.6-luna") return "Luna";
  if (model === "gpt-5.6-terra") return "Terra";
  return "Preview fixture";
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
        setRun((await response.json()) as RunResult);
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
          <span>CALLSMITH / REPORT</span>
          <h1>Report unavailable</h1>
          <p>{visibleError}</p>
          <Link href="/">Return to the workbench</Link>
        </section>
      </main>
    );
  }

  if (!run) {
    return (
      <main className="report-shell report-shell--centered">
        <section className="report-message" role="status">
          <span>CALLSMITH / REPORT</span>
          <h1>Recovering evidence</h1>
          <p>Loading the immutable comparison from Callsmith.</p>
        </section>
      </main>
    );
  }

  const scores = run.attempts.map((attempt) => attempt.score.total);
  const average = scores.length
    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    : 0;
  const passed = run.attempts.filter((attempt) => attempt.score.passed).length;

  return (
    <main className="report-shell">
      <div className="report-wrap">
        <header className="report-header">
          <div>
            <Link href="/">Callsmith / reliability report</Link>
            <h1>{run.scenarioId.replaceAll("-", " ")}</h1>
            <p>
              Synthetic sandbox evidence for {run.suiteId} {run.suiteVersion}. This
              unlisted report is read-only and contains no customer data or provider key.
            </p>
          </div>
          <div className="report-badges">
            <span>Read only</span>
            <span>{run.provenance}</span>
          </div>
        </header>

        <section className="report-summary" aria-label="Run summary">
          {[
            ["Status", run.status.replaceAll("_", " ")],
            ["Average score", `${average}/100`],
            ["Passed", `${passed}/${run.attempts.length}`],
            ["Seed", String(run.seed)],
          ].map(([label, value]) => (
            <div key={label}>
              <p>{label}</p>
              <strong>{value}</strong>
            </div>
          ))}
        </section>

        <section className="report-attempts" aria-labelledby="attempts-heading">
          <div className="report-section-heading">
            <h2 id="attempts-heading">Attempt evidence</h2>
            <span>{run.attempts.length} captured</span>
          </div>

          {run.attempts.length === 0 ? (
            <div className="report-empty">
              No completed attempt evidence is available. The run ended before a model
              or preview trace could be evaluated.
            </div>
          ) : (
            <div className="report-attempt-grid">
              {run.attempts.map((attempt) => (
                <article className="report-attempt" key={attempt.id}>
                  <div className="report-attempt-topline">
                    <div>
                      <p>{formatModel(attempt.model)} · {attempt.provenance}</p>
                      <h3>
                        {attempt.score.passed ? "Workflow held" : "Reliability gap found"}
                      </h3>
                    </div>
                    <strong>{attempt.score.total}<small>/100</small></strong>
                  </div>

                  <div className="report-score-grid">
                    {[
                      ["Task outcome", attempt.score.taskOutcome],
                      ["Trajectory", attempt.score.trajectory],
                      ["Safety", attempt.score.safety],
                      ["Recovery", attempt.score.recovery],
                    ].map(([category, component]) => {
                      const score = component as { earned: number; possible: number };
                      return (
                        <div key={String(category)}>
                          <p>{String(category)}</p>
                          <strong>{score.earned}/{score.possible}</strong>
                        </div>
                      );
                    })}
                  </div>

                  <ol className="report-trace">
                    {attempt.trace.map((trace) => (
                      <li key={trace.id}>
                        <span>{String(trace.sequence).padStart(2, "0")}</span>
                        <p>
                          <strong>{trace.toolName ?? trace.type}</strong>{" "}
                          {trace.message ?? trace.faultType ?? "state captured"}
                        </p>
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
