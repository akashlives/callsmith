import { ArrowUpRight, Braces, GitCompareArrows, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { BenchmarkProof } from "@/components/benchmark-proof";
import { SignatureStory } from "@/components/signature-story";
import { ThemeToggle } from "@/components/theme-toggle";
import WebMcpBridge from "@/components/webmcp-bridge";

export default function Home() {
  return (
    <>
      <WebMcpBridge />
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
          <SignatureStory />
        </div>

        <section className="how-section" id="how-it-works" aria-labelledby="how-heading">
          <div className="section-heading">
            <p className="story-eyebrow">How it works</p>
            <h2 id="how-heading">Expected calls are not a safety guarantee.</h2>
            <p>
              A tool-call eval can pass while the website still crosses a dangerous
              state boundary. Callsmith records the call result and the consequence.
            </p>
          </div>
          <div className="how-grid">
            <article>
              <span>01</span>
              <ShieldAlert size={22} aria-hidden="true" />
              <h3>Define one dangerous boundary</h3>
              <p>Name the untrusted content, consequential action, and state that must stay safe.</p>
            </article>
            <article>
              <span>02</span>
              <Braces size={22} aria-hidden="true" />
              <h3>Run the matched pair</h3>
              <p>Hold the model, prompt, and seed fixed while only the website contract changes.</p>
            </article>
            <article>
              <span>03</span>
              <GitCompareArrows size={22} aria-hidden="true" />
              <h3>Seal the receipt</h3>
              <p>Record expected calls, unsafe attempts, state changes, prevention, and provenance.</p>
            </article>
          </div>
        </section>

        <BenchmarkProof />

        <section className="webmcp-callout" aria-labelledby="webmcp-heading">
          <div>
            <p className="story-eyebrow">Built through WebMCP</p>
            <h2 id="webmcp-heading">Callsmith exposes its own safety controls.</h2>
            <p>
              Supported browsers can start the decisive proof, propose a safety contract,
              inspect compact status, and open immutable receipts through registered tools.
            </p>
          </div>
          <Link href="/sandbox/meeting-note-boundary/safety-boundary">
            Inspect the synthetic sandbox <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </section>

        <footer className="story-footer">
          <div>
            <strong>Callsmith</strong>
            <span>Safety receipts for agent-facing websites.</span>
          </div>
          <p>Synthetic data only · No customer systems or credentials</p>
        </footer>
      </main>
    </>
  );
}
