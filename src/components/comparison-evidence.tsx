import type {
  AttemptComparisonView,
  ContractBenchmarkStats,
} from "./case-comparison";

const scoreLabels = {
  taskOutcome: "Task outcome",
  trajectory: "Trajectory",
  safety: "Safety",
  recovery: "Recovery",
} as const;

export function OutcomeCards({
  attempts,
  verdictAllowed = true,
}: {
  attempts: AttemptComparisonView[];
  verdictAllowed?: boolean;
}) {
  const visibleAttempts =
    attempts.length > 4
      ? (["weak", "hardened"] as const).flatMap((contractVariant) => {
          const attempt = attempts.find(
            (candidate) => candidate.contractVariant === contractVariant,
          );
          return attempt ? [attempt] : [];
        })
      : attempts;
  return (
    <div className="outcome-grid" aria-label="Agent behavior comparison">
      {visibleAttempts.map((attempt) => {
        const unavailable = attempt.status === "provider_failure";
        const displayTone = verdictAllowed ? attempt.tone : "neutral";
        const displayOutcome =
          verdictAllowed || unavailable
            ? attempt.outcome
            : "Preserved attempt evidence";
        const displaySummary =
          verdictAllowed || unavailable
            ? attempt.summary
            : "This attempt completed, but the run does not contain enough matched evidence to support a comparison verdict.";

        return (
          <article className={`outcome-card is-${displayTone}`} key={attempt.id}>
          <div className="outcome-card__topline">
            <div>
              <span className="outcome-card__model">
                <i aria-hidden="true" /> {attempt.contractLabel}
              </span>
              <small>
                {attempt.modelLabel}
                {attempt.attemptLabel ? ` · ${attempt.attemptLabel}` : ""}
              </small>
            </div>
            <span className="outcome-card__score" aria-label={`${attempt.score} out of 100`}>
              {attempt.score}<small>/100</small>
            </span>
          </div>
          <h3>{displayOutcome}</h3>
          <p>{displaySummary}</p>
          <dl className="outcome-card__safety">
            <div>
              <dt>Task complete</dt>
              <dd>{attempt.taskCompleted ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Unsafe attempt</dt>
              <dd>{attempt.unsafeAttempted ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Harm prevented</dt>
              <dd>{attempt.harmPrevented ? "Yes" : "No"}</dd>
            </div>
          </dl>
          {attempt.baselineEvaluation ? (
            <p className={`baseline-verdict is-${attempt.baselineEvaluation.outcome}`}>
              Official expected-call baseline: {attempt.baselineEvaluation.outcome}
              {verdictAllowed &&
              attempt.baselineEvaluation.outcome === "pass" &&
              attempt.safetyOutcome === "unsafe_mutation"
                ? " — Callsmith disagrees"
                : ""}
            </p>
          ) : null}
          <div className="outcome-card__meta">
            <span>
              {attempt.provenance === "browser_webmcp"
                ? "Browser WebMCP"
                : attempt.provenance === "server_simulation"
                  ? "Server simulation"
                  : "Preview"}
            </span>
            <span>{attempt.latencyLabel}</span>
            {attempt.costLabel ? <span>{attempt.costLabel}</span> : null}
          </div>
          </article>
        );
      })}
    </div>
  );
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function rateLabel(rate: ContractBenchmarkStats["taskCompletion"]): string {
  return `${percentage(rate.rate)} (${percentage(rate.lower95)}–${percentage(rate.upper95)} 95% CI)`;
}

export function BenchmarkEvidence({
  stats,
}: {
  stats: ContractBenchmarkStats[];
}) {
  return (
    <section className="benchmark-evidence" aria-labelledby="benchmark-heading">
      <div>
        <p className="story-eyebrow">Immutable benchmark</p>
        <h2 id="benchmark-heading">Ten browser attempts per contract.</h2>
        <p>
          Same model, task, seed schedule, and hostile content. Wilson confidence
          intervals show uncertainty instead of turning one attempt into a reliability claim.
        </p>
      </div>
      <div className="benchmark-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Contract</th>
              <th>Task complete</th>
              <th>Unsafe attempt</th>
              <th>Harm prevented</th>
              <th>Callsmith pass</th>
              <th>Baseline pass</th>
              <th>Latency p50 / p95</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((item) => (
              <tr key={item.contractVariant}>
                <th>{item.contractLabel}<small>{item.attempts} attempts</small></th>
                <td>{rateLabel(item.taskCompletion)}</td>
                <td>{rateLabel(item.unsafeAttempt)}</td>
                <td>{rateLabel(item.preventedHarm)}</td>
                <td>{rateLabel(item.callsmithPass)}</td>
                <td>{rateLabel(item.baselinePass)}</td>
                <td>{(item.latencyP50Ms / 1_000).toFixed(1)}s / {(item.latencyP95Ms / 1_000).toFixed(1)}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ComparisonEvidence({
  attempts,
  summary = "Show the proof",
  id,
  verdictAllowed = true,
}: {
  attempts: AttemptComparisonView[];
  summary?: string;
  id?: string;
  verdictAllowed?: boolean;
}) {
  const visibleAttempts =
    attempts.length > 4
      ? (["weak", "hardened"] as const).flatMap((contractVariant) => {
          const attempt = attempts.find(
            (candidate) => candidate.contractVariant === contractVariant,
          );
          return attempt ? [attempt] : [];
        })
      : attempts;
  return (
    <details className="evidence-disclosure" id={id}>
      <summary>
        <span>
          <small>Evidence</small>
          <strong>{summary}</strong>
        </span>
        <i aria-hidden="true">+</i>
      </summary>

      <div className="evidence-body">
        <div className="evidence-comparison">
          {visibleAttempts.map((attempt) => {
            const unavailable = attempt.status === "provider_failure";
            return (
              <section className="evidence-lane" key={attempt.id}>
                <header>
                  <span
                    className={`evidence-lane__marker is-${verdictAllowed ? attempt.tone : "neutral"}`}
                  />
                  <div>
                    <p>{attempt.contractLabel} · {attempt.modelLabel}</p>
                    <h3>
                      {verdictAllowed || unavailable
                        ? attempt.outcome
                        : "Observed attempt evidence"}
                    </h3>
                  </div>
                </header>
                <ol className="plain-trace">
                  {attempt.evidence.map((event) => (
                    <li className={`is-${event.tone}`} key={event.id}>
                      <span>{String(event.sequence + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{event.title}</strong>
                        <p>{event.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>

        <div className="state-evidence">
          {visibleAttempts.map((attempt) => (
            <section key={attempt.id}>
              <p className="section-kicker">{attempt.contractLabel} · final browser state</p>
              <div className="state-facts">
                {attempt.stateFacts.map((fact) => (
                  <div className={`is-${fact.tone}`} key={fact.label}>
                    <span>{fact.label}</span>
                    <strong>{fact.value}</strong>
                  </div>
                ))}
              </div>
              {attempt.stateChanges.length ? (
                <p className="changed-paths">
                  Changed: <code>{attempt.stateChanges.join(", ")}</code>
                </p>
              ) : null}
            </section>
          ))}
        </div>

        <details className="developer-disclosure">
          <summary>Developer evidence</summary>
          <div className="developer-grid">
            {visibleAttempts.map((attempt) => (
              <section key={attempt.id}>
                <header>
                  <h3>{attempt.contractLabel}</h3>
                  <span>{attempt.status.replaceAll("_", " ")}</span>
                </header>
                <div className="score-breakdown">
                  {(Object.keys(scoreLabels) as Array<keyof typeof scoreLabels>).map(
                    (key) => {
                      const component = attempt.scorecard[key];
                      return (
                        <div key={key}>
                          <span>{scoreLabels[key]}</span>
                          <strong>{component.earned}/{component.possible}</strong>
                        </div>
                      );
                    },
                  )}
                </div>
                <ul className="assertion-list">
                  {attempt.assertions.map((assertion) => (
                    <li className={assertion.passed ? "is-safe" : "is-risk"} key={assertion.assertionId}>
                      <span aria-hidden="true">{assertion.passed ? "✓" : "×"}</span>
                      <p>{assertion.explanation}</p>
                    </li>
                  ))}
                </ul>
                <dl className="execution-metadata">
                  <div><dt>Provenance</dt><dd>{attempt.provenance}</dd></div>
                  <div><dt>Engine</dt><dd>{attempt.executionMetadata.webMcpEngine}@{attempt.executionMetadata.webMcpEngineVersion}</dd></div>
                  <div><dt>Browser</dt><dd>{attempt.executionMetadata.browserVersion ?? "not applicable"}</dd></div>
                  <div><dt>Seed</dt><dd>{attempt.executionMetadata.seed}</dd></div>
                </dl>
                <details className="raw-disclosure">
                  <summary>Normalized trace JSON</summary>
                  <pre>{JSON.stringify(attempt.trace, null, 2)}</pre>
                </details>
              </section>
            ))}
          </div>
        </details>
      </div>
    </details>
  );
}
