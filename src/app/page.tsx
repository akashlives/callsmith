import Link from "next/link";

import { BenchmarkProof } from "@/components/benchmark-proof";
import { SignatureStory } from "@/components/signature-story";
import { ThemeToggle } from "@/components/theme-toggle";
import WebMcpBridge from "@/components/webmcp-bridge";
import { pipedreamConnectEnabled } from "@/lib/evidence-receipt-server";

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
            <a href="#evidence">Evidence</a>
            <Link href="/sandbox/meeting-note-boundary/safety-boundary">Sandbox</Link>
          </nav>
          <ThemeToggle />
        </header>

        <div id="top">
          <SignatureStory pipedreamConnectEnabled={pipedreamConnectEnabled()} />
        </div>

        <BenchmarkProof />

        <section className="webmcp-callout" aria-labelledby="webmcp-heading">
          <div>
            <p className="story-eyebrow">Page tools · WebMCP</p>
            <h2 id="webmcp-heading">Five workbench tools here. CRM tools live on the sandbox.</h2>
            <p>
              This page registers get_contract_template, propose_safety_contract,
              get_callsmith_status, run_decisive_case, and open_evidence_receipt through
              document.modelContext.registerTool. The meeting-note tools
              read_meeting_note and send_followup register on the sandbox page. Pipedream
              Connect is an optional write backend, never the demo, and never the guest
              path.
            </p>
          </div>
          <Link href="/sandbox/meeting-note-boundary/safety-boundary">
            Inspect the synthetic sandbox
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
