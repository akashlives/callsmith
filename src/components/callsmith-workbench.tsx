"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Braces,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  Database,
  FileJson2,
  Flame,
  Gauge,
  GitCompareArrows,
  Hammer,
  Layers3,
  LockKeyhole,
  Play,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CallsmithWorkbenchProps,
  ModelResult,
  RunConfiguration,
  RunPhase,
  TraceEvent,
} from "./workbench-types";

const phaseCopy: Record<RunPhase, { label: string; message: string }> = {
  ready: {
    label: "Ready",
    message: "The forge is seeded. Start the signature preview when you are ready.",
  },
  queued: {
    label: "Queued",
    message: "Allocating an isolated browser and reproducing the fault schedule.",
  },
  running: {
    label: "Evaluating",
    message: "Agents are working against identical state and deterministic faults.",
  },
  recovering: {
    label: "Recovering",
    message: "A stale-context fault landed. Watching the agent’s recovery path.",
  },
  complete: {
    label: "Verified",
    message: "The run finished. Compare the traces, not just the final answers.",
  },
  error: {
    label: "Runner paused",
    message: "The attempt stopped safely. Completed evidence is preserved for retry.",
  },
};

const traceIcons: Record<TraceEvent["type"], typeof Activity> = {
  context: ScanSearch,
  tool: Terminal,
  fault: AlertTriangle,
  recovery: RefreshCw,
  boundary: LockKeyhole,
  result: Check,
};

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span className="brand-mark__spark" />
      <Hammer size={20} strokeWidth={2.3} />
    </div>
  );
}

function ProvenanceBadge({ provenance }: Pick<CallsmithWorkbenchProps, "provenance">) {
  const preview = provenance !== "live";

  return (
    <span className={`provenance-badge ${preview ? "is-preview" : "is-live"}`}>
      <CircleDot size={12} />
      {preview ? "Preview evidence" : "Live model run"}
    </span>
  );
}

function ScoreRing({ score, accent }: { score: number; accent: ModelResult["accent"] }) {
  return (
    <div
      className={`score-ring score-ring--${accent}`}
      style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}
      aria-label={`${score} out of 100`}
    >
      <div className="score-ring__inner">
        <strong>{score}</strong>
        <span>/100</span>
      </div>
    </div>
  );
}

function TraceItem({ event, pending }: { event: TraceEvent; pending?: boolean }) {
  const Icon = traceIcons[event.type];

  return (
    <li className={`trace-item trace-item--${event.type} ${pending ? "is-pending" : ""}`}>
      <div className="trace-item__rail" aria-hidden="true">
        <span className="trace-item__node">
          <Icon size={13} strokeWidth={2.2} />
        </span>
      </div>
      <div className="trace-item__content">
        <div className="trace-item__meta">
          <span>STEP {String(event.sequence).padStart(2, "0")}</span>
          {event.duration ? <span>{event.duration}</span> : null}
        </div>
        <h4>{event.title}</h4>
        <p>{event.detail}</p>
        {event.tool ? <code>{event.tool}()</code> : null}
      </div>
    </li>
  );
}

function RuntimeNotice({ phase }: { phase: RunPhase }) {
  const isWarning = phase === "recovering" || phase === "error";
  const Icon = phase === "complete" ? ShieldCheck : isWarning ? RotateCcw : Activity;

  return (
    <div className={`runtime-notice runtime-notice--${phase}`} role="status" aria-live="polite">
      <Icon size={15} />
      <div>
        <strong>{phaseCopy[phase].label}</strong>
        <span>{phaseCopy[phase].message}</span>
      </div>
    </div>
  );
}

export function CallsmithWorkbench({
  data,
  provenance = "preview",
  initialPhase = "complete",
  onRun,
}: CallsmithWorkbenchProps) {
  const signatureScenario =
    data.suite.scenarios.find((scenario) => scenario.id === "signature") ??
    data.suite.scenarios[0];
  const [selectedScenarioId, setSelectedScenarioId] = useState(signatureScenario?.id ?? "");
  const [selectedModels, setSelectedModels] = useState<ModelResult["id"][]>(
    data.models.map((model) => model.id),
  );
  const [repetitions, setRepetitions] = useState(3);
  const [phase, setPhase] = useState<RunPhase>(initialPhase);
  const [progress, setProgress] = useState(initialPhase === "complete" ? 100 : 0);
  const [visibleTraceCount, setVisibleTraceCount] = useState(
    initialPhase === "complete" ? data.traces.length : 0,
  );
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const selectedScenario = useMemo(
    () =>
      data.suite.scenarios.find((scenario) => scenario.id === selectedScenarioId) ??
      data.suite.scenarios[0],
    [data.suite.scenarios, selectedScenarioId],
  );

  useEffect(() => {
    return () => timers.current.forEach((timer) => clearTimeout(timer));
  }, []);

  function toggleModel(modelId: ModelResult["id"]) {
    setSelectedModels((current) => {
      if (current.includes(modelId)) {
        return current.length === 1 ? current : current.filter((id) => id !== modelId);
      }
      return [...current, modelId];
    });
  }

  function setRunMoment(
    delay: number,
    nextPhase: RunPhase,
    nextProgress: number,
    traceCount: number,
  ) {
    const timer = setTimeout(() => {
      setPhase(nextPhase);
      setProgress(nextProgress);
      setVisibleTraceCount(traceCount);
    }, delay);
    timers.current.push(timer);
  }

  async function startRun() {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current = [];

    const configuration: RunConfiguration = {
      scenarioId: selectedScenarioId,
      models: selectedModels,
      repetitions,
      seed: 260826,
    };

    setPhase("queued");
    setProgress(8);
    setVisibleTraceCount(0);

    if (onRun) {
      try {
        await onRun(configuration);
      } catch {
        setPhase("error");
        setProgress(42);
        return;
      }
    }

    setRunMoment(450, "running", 28, 1);
    setRunMoment(950, "running", 46, 2);
    setRunMoment(1_450, "recovering", 64, 3);
    setRunMoment(2_050, "running", 82, 4);
    setRunMoment(2_550, "running", 93, 5);
    setRunMoment(3_050, "complete", 100, data.traces.length);
  }

  const isRunning = phase === "queued" || phase === "running" || phase === "recovering";
  const visibleTraces = data.traces.slice(0, visibleTraceCount);

  return (
    <main className="callsmith-app">
      <a className="skip-link" href="#sandbox-panel">
        Skip to sandbox
      </a>

      <header className="topbar">
        <div className="topbar__brand">
          <BrandMark />
          <div>
            <div className="wordmark">CALLSMITH</div>
            <p>Forge tool calls that hold up in the real world.</p>
          </div>
        </div>

        <div className="topbar__center" aria-label="Run provenance and environment">
          <ProvenanceBadge provenance={provenance} />
          <span className="environment-badge">
            <span className="environment-badge__dot" />
            Isolated browser
          </span>
          <span className="seed-badge">SEED 260826</span>
        </div>

        <div className="topbar__actions">
          <button className="button button--ghost" type="button" aria-label="Open suite JSON editor">
            <Braces size={15} />
            <span>Suite JSON</span>
          </button>
          <button className="avatar-button" type="button" aria-label="Open guest account menu">
            AS
          </button>
        </div>
      </header>

      <section className="runbar" aria-label="Run configuration">
        <div className="runbar__identity">
          <div className="eyebrow">
            <Flame size={13} /> FEATURED SUITE
          </div>
          <div className="runbar__titleline">
            <h1>{data.suite.title}</h1>
            <span>{data.suite.version}</span>
          </div>
        </div>

        <div className="runbar__controls">
          <fieldset className="model-toggle">
            <legend>Models</legend>
            {data.models.map((model) => {
              const active = selectedModels.includes(model.id);
              return (
                <button
                  key={model.id}
                  className={`model-toggle__item is-${model.accent} ${active ? "is-active" : ""}`}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleModel(model.id)}
                >
                  <span className="model-toggle__light" />
                  {model.label}
                </button>
              );
            })}
          </fieldset>

          <div className="repetition-control" aria-label="Run repetitions">
            <span>Repetitions</span>
            <div>
              <button
                type="button"
                onClick={() => setRepetitions((value) => Math.max(1, value - 1))}
                aria-label="Decrease repetitions"
              >
                −
              </button>
              <strong>{repetitions}×</strong>
              <button
                type="button"
                onClick={() => setRepetitions((value) => Math.min(3, value + 1))}
                aria-label="Increase repetitions"
              >
                +
              </button>
            </div>
          </div>

          <button
            className="run-button"
            type="button"
            onClick={startRun}
            disabled={isRunning}
          >
            {isRunning ? <RefreshCw className="spin" size={17} /> : <Play size={17} fill="currentColor" />}
            <span>{isRunning ? phaseCopy[phase].label : "Run signature preview"}</span>
            {!isRunning ? <span className="run-button__shortcut">R</span> : null}
          </button>
        </div>

        <div className="run-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      </section>

      <RuntimeNotice phase={phase} />

      <div className="workbench-grid">
        <aside className="panel suite-rail" aria-label="Suite scenarios">
          <div className="panel__header">
            <div>
              <span className="panel__overline">SUITE MAP</span>
              <h2>Six ways agents break</h2>
            </div>
            <button className="icon-button" type="button" aria-label="Suite options">
              <ChevronDown size={16} />
            </button>
          </div>

          <div className="suite-summary">
            <div className="suite-summary__icon">
              <Workflow size={17} />
            </div>
            <p>{data.suite.description}</p>
          </div>

          <nav className="scenario-list" aria-label="Scenarios">
            {data.suite.scenarios.map((scenario) => {
              const active = scenario.id === selectedScenarioId;
              return (
                <button
                  className={`scenario-item ${active ? "is-active" : ""}`}
                  type="button"
                  key={scenario.id}
                  onClick={() => setSelectedScenarioId(scenario.id)}
                  aria-current={active ? "true" : undefined}
                >
                  <span className="scenario-item__index">{scenario.label}</span>
                  <span className="scenario-item__body">
                    <strong>{scenario.title}</strong>
                    <small>{scenario.description}</small>
                    <span className="fault-tags">
                      {scenario.faults.map((fault) => (
                        <span key={fault}>{fault.replaceAll("_", " ")}</span>
                      ))}
                    </span>
                  </span>
                  <span className={`scenario-item__status is-${scenario.status}`} aria-hidden="true">
                    {scenario.status === "verified" ? <Check size={11} /> : null}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="suite-rail__footer">
            <div>
              <FileJson2 size={15} />
              <span>
                <strong>Schema valid</strong>
                12 tools · 24 assertions
              </span>
            </div>
            <button type="button">Inspect</button>
          </div>
        </aside>

        <section className="center-stage" id="sandbox-panel" aria-label="Synthetic CRM sandbox">
          <div className="sandbox-window">
            <div className="sandbox-toolbar">
              <div className="sandbox-toolbar__browser" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="sandbox-toolbar__title">
                <Database size={14} />
                <strong>Tavolo CRM</strong>
                <span>SYNTHETIC SANDBOX</span>
              </div>
              <div className="sandbox-toolbar__tools">
                <span><Zap size={12} /> 7 tools exposed</span>
                <button type="button" aria-label="Refresh sandbox"><RefreshCw size={14} /></button>
              </div>
            </div>

            <div className="sandbox-context-bar">
              <div>
                <span className="status-dot status-dot--mint" />
                <span>Scenario</span>
                <strong>{selectedScenario?.title}</strong>
              </div>
              <div className="sandbox-context-bar__revision">
                <span>STATE REV</span>
                <strong>08</strong>
                <span className="revision-change">+1</span>
              </div>
            </div>

            <div className="crm-canvas">
              <div className="crm-heading">
                <div>
                  <span className="crm-heading__logo">N</span>
                  <div>
                    <p>ACCOUNT / LOGISTICS</p>
                    <h2>{data.state.account.name}</h2>
                    <span>{data.state.account.domain}</span>
                  </div>
                </div>
                <span className="crm-heading__stage">{data.state.account.stage}</span>
              </div>

              <div className="crm-metrics">
                <div>
                  <span>Opportunity</span>
                  <strong>{data.state.account.value}</strong>
                </div>
                <div>
                  <span>Owner</span>
                  <strong>{data.state.account.owner}</strong>
                </div>
                <div>
                  <span>Confidence</span>
                  <strong className="metric-positive">72% <span>↑ 8</span></strong>
                </div>
              </div>

              <div className="crm-grid">
                <article className="crm-card meeting-card">
                  <header>
                    <div className="crm-card__icon"><Bot size={15} /></div>
                    <div>
                      <p>LATEST MEETING</p>
                      <h3>{data.state.meeting.title}</h3>
                    </div>
                    <span>{data.state.meeting.relativeTime}</span>
                  </header>
                  <div className="meeting-card__warning">
                    <RefreshCw size={13} />
                    <span>{data.state.meeting.status}</span>
                    <code>rev 7 → 8</code>
                  </div>
                  <p className="meeting-card__summary">“{data.state.meeting.summary}”</p>
                  <footer>
                    <span><Layers3 size={12} /> {data.state.meeting.source}</span>
                    <span className="trust-label"><ShieldCheck size={12} /> Trusted context</span>
                  </footer>
                </article>

                <article className="crm-card followup-card">
                  <header>
                    <div className="crm-card__icon"><Check size={15} /></div>
                    <div>
                      <p>FOLLOW-UP TASK</p>
                      <h3>{data.state.followUp.task}</h3>
                    </div>
                    <span className="created-pill">CREATED</span>
                  </header>
                  <dl>
                    <div><dt>Assignee</dt><dd>{data.state.followUp.assignee}</dd></div>
                    <div><dt>Due</dt><dd>{data.state.followUp.due}</dd></div>
                  </dl>
                  <div className="confirmation-boundary">
                    <div>
                      <LockKeyhole size={14} />
                      <span>
                        <strong>Human boundary held</strong>
                        {data.state.followUp.replyStatus}
                      </span>
                    </div>
                    <button type="button" disabled>Send reply</button>
                  </div>
                </article>
              </div>

              <div className="state-diff">
                <div className="state-diff__heading">
                  <span><GitCompareArrows size={14} /> STATE DIFF</span>
                  <strong>2 safe mutations</strong>
                </div>
                <code><span>+</span> opportunity.stage <b>“Solution fit”</b></code>
                <code><span>+</span> follow_up.id <b>“task_syn_1042”</b></code>
                <code className="state-diff__blocked"><span>×</span> external_message.send <b>blocked</b></code>
              </div>
            </div>
          </div>

          <section className="comparison-section" aria-labelledby="comparison-title">
            <div className="comparison-section__heading">
              <div>
                <span className="panel__overline">MODEL COMPARISON · 3 IDENTICAL RUNS</span>
                <h2 id="comparison-title">Same task. Different instincts.</h2>
              </div>
              <ProvenanceBadge provenance={provenance} />
            </div>

            <div className="comparison-grid">
              {data.models.map((model) => (
                <article className={`model-result model-result--${model.accent}`} key={model.id}>
                  <div className="model-result__topline">
                    <div>
                      <span className="model-result__dot" />
                      <div>
                        <strong>{model.label}</strong>
                        <small>{model.role}</small>
                      </div>
                    </div>
                    <ScoreRing score={model.score} accent={model.accent} />
                  </div>
                  <div className="model-result__stats">
                    <span><small>PASS RATE</small><strong>{model.passRate}%</strong></span>
                    <span><small>LATENCY</small><strong>{model.latency}</strong></span>
                    <span><small>COST</small><strong>{model.cost}</strong></span>
                  </div>
                  <p>{model.verdict}</p>
                  <button type="button">Inspect trace <ArrowRight size={14} /></button>
                </article>
              ))}
            </div>
          </section>
        </section>

        <aside className="panel evidence-panel" aria-label="Trace and assertions">
          <div className="evidence-tabs" role="tablist" aria-label="Evidence view">
            <button type="button" role="tab" aria-selected="true">Trace</button>
            <button type="button" role="tab" aria-selected="false">Diff</button>
            <button type="button" role="tab" aria-selected="false">Raw</button>
            <span>{visibleTraces.length}/{data.traces.length}</span>
          </div>

          <div className="trace-header">
            <div>
              <span className="panel__overline">AGENT TRAJECTORY</span>
              <h2>What actually happened</h2>
            </div>
            <span className="trace-header__live"><span /> LIVE</span>
          </div>

          <div className="trace-scroll">
            {visibleTraces.length ? (
              <ol className="trace-list">
                {visibleTraces.map((event) => <TraceItem event={event} key={event.id} />)}
              </ol>
            ) : (
              <div className="trace-empty">
                {phase === "error" ? <AlertTriangle size={25} /> : <Activity size={25} />}
                <strong>{phase === "error" ? "Runner disconnected safely" : "Trace channel open"}</strong>
                <p>
                  {phase === "error"
                    ? "Completed events are preserved. Retry when the browser runner is healthy."
                    : "Waiting for the first browser tool call. Evidence will stream here."}
                </p>
              </div>
            )}
            {isRunning && visibleTraces.length > 0 ? (
              <div className="trace-waiting"><span /> Waiting for next event</div>
            ) : null}
          </div>

          <section className="assertions" aria-labelledby="assertion-heading">
            <div className="assertions__heading">
              <div>
                <Gauge size={15} />
                <h2 id="assertion-heading">Score anatomy</h2>
              </div>
              <strong>100<span>/100</span></strong>
            </div>
            <div className="assertion-list">
              {data.assertions.map((assertion) => (
                <div className="assertion-item" key={assertion.id}>
                  <span className={`assertion-item__result ${assertion.passed ? "is-pass" : "is-fail"}`}>
                    {assertion.passed ? <Check size={11} /> : "×"}
                  </span>
                  <span>
                    <strong>{assertion.label}</strong>
                    <small>{assertion.detail}</small>
                  </span>
                  <b>+{assertion.weight}</b>
                </div>
              ))}
            </div>
            <div className="assertions__footer">
              <Sparkles size={14} />
              <span><strong>Judge the trajectory.</strong> Final answers can hide unsafe behavior.</span>
            </div>
          </section>
        </aside>
      </div>

      <footer className="app-footer">
        <div><span className="status-dot status-dot--mint" /> WebMCP bridge ready</div>
        <div><ShieldCheck size={13} /> Synthetic data only</div>
        <div><Clock3 size={13} /> Last preview: deterministic fixture</div>
        <div className="app-footer__right"><span>Callsmith</span> / reliability workbench</div>
      </footer>
    </main>
  );
}

export default CallsmithWorkbench;
