import { ArrowUpRight, Braces, GitCompareArrows, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

import { SignatureStory, type ScenarioOption } from "@/components/signature-story";
import SuiteAuthoringBridge from "@/components/suite-authoring-bridge";
import { ThemeToggle } from "@/components/theme-toggle";
import WebMcpBridge from "@/components/webmcp-bridge";
import { browserQueueConfigured } from "@/lib/run-queue";
import { SALES_GAUNTLET_SUITE } from "@/lib/suites";

const scenarioNames: Record<string, string> = {
  "happy-path": "Clean handoff",
  "ambiguous-account": "Identity collision",
  "stale-context": "Stale context",
  "transient-error": "Network fracture",
  "duplicate-mutation": "Duplicate mutation",
  "injection-confirmation": "The meeting-note trap",
};

export default async function Home() {
  await connection();
  const scenarios: ScenarioOption[] = SALES_GAUNTLET_SUITE.scenarios.map((scenario) => ({
    id: scenario.id,
    title: scenarioNames[scenario.id] ?? scenario.title,
    description: scenario.description,
    seed: scenario.seed,
  }));

  return (
    <>
      <WebMcpBridge />
      <SuiteAuthoringBridge />
      <main className="story-app">
        <header className="site-header">
          <a className="site-brand" href="#top" aria-label="Callsmith home">
            <span aria-hidden="true">C</span>
            <strong>Callsmith</strong>
          </a>
          <nav aria-label="Primary navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#evidence">Evidence</a>
          </nav>
          <ThemeToggle />
        </header>

        <div id="top">
          <SignatureStory
            scenarios={scenarios}
            modelRunnerConfigured={
              browserQueueConfigured() &&
              Boolean(process.env.OPENAI_API_KEY) &&
              Boolean(process.env.CALLSMITH_RUNNER_TOKEN)
            }
            deterministicPreviewEnabled={
              process.env.CALLSMITH_DETERMINISTIC_PREVIEW_ENABLED === "true"
            }
          />
        </div>

        <section className="how-section" id="how-it-works" aria-labelledby="how-heading">
          <div className="section-heading">
            <p className="story-eyebrow">How it works</p>
            <h2 id="how-heading">Test the behavior, not just the registration.</h2>
            <p>
              A conventional eval can pass because the expected call appeared while the
              website still crossed an unsafe state boundary. Callsmith records both.
            </p>
          </div>
          <div className="how-grid">
            <article>
              <span>01</span>
              <ShieldAlert size={22} aria-hidden="true" />
              <h3>Plant controlled trouble</h3>
              <p>Inject stale state, ambiguity, prompt attacks, retries, and duplicate traps.</p>
            </article>
            <article>
              <span>02</span>
              <Braces size={22} aria-hidden="true" />
              <h3>Watch the tool path</h3>
              <p>Capture normalized calls, arguments, state changes, and confirmation boundaries.</p>
            </article>
            <article>
              <span>03</span>
              <GitCompareArrows size={22} aria-hidden="true" />
              <h3>Compare contract design</h3>
              <p>Keep the model and prompt fixed; change only what the website guarantees.</p>
            </article>
          </div>
        </section>

        <section className="webmcp-callout" aria-labelledby="webmcp-heading">
          <div>
            <p className="story-eyebrow">Built through WebMCP</p>
            <h2 id="webmcp-heading">The workbench is agent-operable too.</h2>
            <p>
              Supported browsers can discover Callsmith’s suites, start comparisons,
              inspect run status, and open read-only reports through registered tools.
            </p>
          </div>
          <Link href="/sandbox/sales-follow-through/injection-confirmation">
            Open the synthetic sandbox <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </section>

        <footer className="story-footer">
          <div>
            <strong>Callsmith</strong>
            <span>The WebMCP reliability workbench.</span>
          </div>
          <p>Synthetic data only · No customer systems or credentials</p>
        </footer>
      </main>
    </>
  );
}
