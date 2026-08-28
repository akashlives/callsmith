import { Download, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { experimentRepository } from "@/lib/experiment-repository";
import type { ReceiptAttemptEvidence } from "@/lib/evidence-receipt";

export const dynamic = "force-dynamic";

function Outcome({
  label,
  evidence,
  tone,
}: {
  label: string;
  evidence: ReceiptAttemptEvidence;
  tone: "risk" | "safe";
}) {
  const heading =
    evidence.facts.protectedState === "mutated"
      ? "Protected state mutated"
      : evidence.facts.protectedState === "preserved" &&
          evidence.facts.harmPrevention === "prevented"
        ? "Harm was prevented"
        : "Evidence was inconclusive";

  return (
    <article className={`outcome-card is-${tone}`}>
      <div className="outcome-card__topline">
        <span className="outcome-card__model"><i aria-hidden="true" /> {label}</span>
        <small>{evidence.execution.model}</small>
      </div>
      <h3>{heading}</h3>
      <p>
        Official expected calls: {evidence.facts.officialExpectedCallBaseline}. Unsafe
        action: {evidence.facts.unsafeAction}. Human boundary: {evidence.facts.harmPrevention}.
      </p>
      <dl className="receipt-facts">
        <div><dt>Expected calls</dt><dd>{evidence.facts.officialExpectedCallBaseline}</dd></div>
        <div><dt>Unsafe action</dt><dd>{evidence.facts.unsafeAction}</dd></div>
        <div><dt>Protected state</dt><dd>{evidence.facts.protectedState}</dd></div>
        <div><dt>Harm prevention</dt><dd>{evidence.facts.harmPrevention}</dd></div>
        <div><dt>Task outcome</dt><dd>{evidence.facts.taskOutcome}</dd></div>
      </dl>
    </article>
  );
}

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const receipt = await experimentRepository.getReceipt(token);
  if (!receipt) notFound();
  const decisive = receipt.conclusion === "hardened_prevented_harm";

  return (
    <main className="report-wrap">
      <header className="report-header">
        <Link className="site-brand" href="/">
          <span aria-hidden="true">C</span><strong>Callsmith</strong>
        </Link>
        <span>Immutable evidence receipt</span>
        <ThemeToggle />
      </header>

      <section className="report-hero">
        <p className="story-eyebrow">SHA-256 verified · read only</p>
        <h1>
          {decisive
            ? "Expected calls passed. Only the hardened website prevented harm."
            : "This receipt preserves an inconclusive safety result."}
        </h1>
        <p>
          Same model, prompt, and seed. This report records the official call matcher
          beside the protected browser state—not a weighted score.
        </p>
        <div className="story-hero__trust">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>{receipt.contentHash}</span>
        </div>
      </section>

      <section className="outcome-grid" aria-label="Contract outcomes">
        <Outcome label="Weak contract" evidence={receipt.weak} tone="risk" />
        <Outcome label="Hardened contract" evidence={receipt.hardened} tone="safe" />
      </section>

      <div className="result-actions">
        <a className="secondary-action" href={`/api/receipts/${encodeURIComponent(token)}`} download>
          <Download size={15} aria-hidden="true" /> Download JSON receipt
        </a>
      </div>

      <details className="evidence-disclosure" open>
        <summary>
          <span><small>Developer evidence</small><strong>Reproduce the conclusion</strong></span>
          <i aria-hidden="true">+</i>
        </summary>
        <div className="evidence-body">
          <div className="developer-grid">
            <section>
              <h3>Exact contract difference</h3>
              <pre>{JSON.stringify(receipt.contractDiff, null, 2)}</pre>
            </section>
            <section>
              <h3>Framework provenance</h3>
              <dl className="execution-metadata">
                <div><dt>Prompt</dt><dd>{receipt.prompt}</dd></div>
                <div><dt>Seed</dt><dd>{receipt.seed}</dd></div>
                <div><dt>Browser</dt><dd>{receipt.weak.execution.browserVersion}</dd></div>
                <div><dt>Runner</dt><dd>{receipt.weak.execution.webMcpRunner}@{receipt.weak.execution.webMcpRunnerVersion}</dd></div>
                <div><dt>Node</dt><dd>{receipt.framework.nodeVersion}</dd></div>
                <div><dt>Application</dt><dd>{receipt.framework.applicationRevision}</dd></div>
                <div><dt>Manifest</dt><dd>{receipt.framework.frameworkManifestRevision}</dd></div>
              </dl>
            </section>
          </div>
          <details className="raw-disclosure">
            <summary>Raw normalized evidence</summary>
            <pre>{JSON.stringify({ weak: receipt.weak, hardened: receipt.hardened }, null, 2)}</pre>
          </details>
        </div>
      </details>
    </main>
  );
}
