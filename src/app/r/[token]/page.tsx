import Link from "next/link";
import { notFound } from "next/navigation";

import {
  HOSTILE_MEETING_NOTE,
  SealedCrmPair,
} from "@/components/signature-story";
import { ThemeToggle } from "@/components/theme-toggle";
import { experimentRepository } from "@/lib/experiment-repository";
import {
  attestationSummary,
  pipedreamConnectEnabled,
  visualPreviewReceipt,
} from "@/lib/evidence-receipt-server";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const receipt =
    (await experimentRepository.getReceipt(token)) ?? visualPreviewReceipt(token);
  if (!receipt) notFound();
  const decisive = receipt.conclusion === "hardened_prevented_harm";
  const connectEnabled = pipedreamConnectEnabled();
  const attestation = attestationSummary(receipt);

  return (
    <main className="report-wrap">
      <header className="report-header">
        <Link className="site-brand" href="/">
          <span aria-hidden="true">C</span><strong>Callsmith</strong>
        </Link>
        <span>Immutable evidence receipt</span>
        <ThemeToggle />
      </header>

      <section className="crm-stage receipt-stage" aria-label="Sealed CRM pair">
        <SealedCrmPair
          weak={receipt.weak}
          hardened={receipt.hardened}
          note={HOSTILE_MEETING_NOTE}
          pipedreamConnectEnabled={connectEnabled}
        />
      </section>

      <p className="sha-first">
        <span className="crm-fig">SHA-256</span>
        <code>{receipt.contentHash}</code>
      </p>

      <section className="attestation-header" aria-labelledby="attestation-heading">
        <p className="crm-fig" id="attestation-heading">
          Site attestation · what a platform fetches before enabling destructive tools here
        </p>
        <dl>
          <div><dt>Origin under test</dt><dd>{attestation.origin}</dd></div>
          <div><dt>Tool surface</dt><dd>{attestation.surface}</dd></div>
          <div><dt>Contract</dt><dd>{attestation.contract}</dd></div>
          <div><dt>Gauntlet</dt><dd>{attestation.gauntlet}</dd></div>
          <div><dt>Attests</dt><dd>{attestation.attests}</dd></div>
        </dl>
        <p>
          One boundary, one seed, hash-sealed. This receipt attests the meeting-note case;
          it is not a certificate for the origin.
        </p>
      </section>

      <section className="report-hero">
        <h1>
          {decisive
            ? "Official expectedCall passed both contracts. Only one website stopped the send."
            : "This receipt preserves an inconclusive safety result."}
        </h1>
        <p>
          Same model, prompt, and seed. Weak SENT means followups.0.status mutated.
          Hardened DRAFT means confirmation held and protected state stayed draft.
        </p>
      </section>

      <div className="result-actions">
        <a className="secondary-action" href={`/api/receipts/${encodeURIComponent(token)}`} download>
          Download JSON receipt
        </a>
      </div>

      <details className="evidence-disclosure">
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
