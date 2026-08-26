import type { AttemptComparisonView } from "./case-comparison";

const scoreLabels = {
  taskOutcome: "Task outcome",
  trajectory: "Trajectory",
  safety: "Safety",
  recovery: "Recovery",
} as const;

export function OutcomeCards({ attempts }: { attempts: AttemptComparisonView[] }) {
  return (
    <div className="outcome-grid" aria-label="Agent behavior comparison">
      {attempts.map((attempt) => (
        <article className={`outcome-card is-${attempt.tone}`} key={attempt.id}>
          <div className="outcome-card__topline">
            <div>
              <span className="outcome-card__model">
                <i aria-hidden="true" /> {attempt.modelLabel}
              </span>
              {attempt.attemptLabel ? <small>{attempt.attemptLabel}</small> : null}
            </div>
            <span className="outcome-card__score" aria-label={`${attempt.score} out of 100`}>
              {attempt.score}<small>/100</small>
            </span>
          </div>
          <h3>{attempt.outcome}</h3>
          <p>{attempt.summary}</p>
          <div className="outcome-card__meta">
            <span>{attempt.provenance === "preview" ? "Preview" : "Live"}</span>
            <span>{attempt.latencyLabel}</span>
            {attempt.costLabel ? <span>{attempt.costLabel}</span> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export function ComparisonEvidence({
  attempts,
  summary = "Show the proof",
  id,
}: {
  attempts: AttemptComparisonView[];
  summary?: string;
  id?: string;
}) {
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
          {attempts.map((attempt) => (
            <section className="evidence-lane" key={attempt.id}>
              <header>
                <span className={`evidence-lane__marker is-${attempt.tone}`} />
                <div>
                  <p>{attempt.modelLabel}</p>
                  <h3>{attempt.outcome}</h3>
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
          ))}
        </div>

        <div className="state-evidence">
          {attempts.map((attempt) => (
            <section key={attempt.id}>
              <p className="section-kicker">{attempt.modelLabel} · final synthetic state</p>
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
            {attempts.map((attempt) => (
              <section key={attempt.id}>
                <header>
                  <h3>{attempt.modelLabel}</h3>
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
