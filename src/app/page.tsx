import Link from "next/link";

import { BenchmarkProof } from "@/components/benchmark-proof";
import { SignatureStory, type SealedReceiptPreview } from "@/components/signature-story";
import { ThemeToggle } from "@/components/theme-toggle";
import WebMcpBridge from "@/components/webmcp-bridge";
import {
  HOLD_SANDBOX_PATH,
  TICKETING_SUITE_ID,
} from "@/lib/canonical-contract";
import { stillSrc } from "@/lib/evidence-receipt";
import {
  pipedreamConnectEnabled,
  publicReceiptToken,
} from "@/lib/evidence-receipt-server";
import { experimentRepository } from "@/lib/experiment-repository";

export const dynamic = "force-dynamic";

/** Ticketing sealed pair only. Never invent CHARGED from a meeting-note receipt. */
async function sealedPreview(): Promise<
  (SealedReceiptPreview & { frames?: { weak?: string; hardened?: string } }) | undefined
> {
  try {
    if (typeof experimentRepository.latestDecisiveReceiptForContract !== "function") {
      return undefined;
    }
    const ticketing =
      await experimentRepository.latestDecisiveReceiptForContract(TICKETING_SUITE_ID);
    if (!ticketing || ticketing.conclusion !== "hardened_prevented_harm") {
      return undefined;
    }
    const token = publicReceiptToken();
    const published = token ? await experimentRepository.getReceipt(token) : undefined;
    const match = published?.receiptId === ticketing.receiptId ? token : undefined;
    const stored =
      typeof experimentRepository.listFrames === "function"
        ? await experimentRepository.listFrames(ticketing.experimentId)
        : [];
    const frames = Object.fromEntries(
      stored
        .map((frame) => [frame.contractVariant, stillSrc(frame.screenshot)] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    ) as { weak?: string; hardened?: string };
    return {
      receipt: ticketing,
      token: match ?? "",
      frames,
    };
  } catch {
    return undefined;
  }
}

export default async function Home() {
  const sealed = await sealedPreview();
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
            <Link href={HOLD_SANDBOX_PATH}>Hold</Link>
          </nav>
          <ThemeToggle />
        </header>

        <div id="top">
          <SignatureStory
            pipedreamConnectEnabled={pipedreamConnectEnabled()}
            sealed={sealed?.token ? { receipt: sealed.receipt, token: sealed.token } : undefined}
            frames={sealed?.token ? sealed.frames : undefined}
          />
        </div>

        <BenchmarkProof />

        <section className="webmcp-callout" aria-labelledby="hold-heading">
          <div>
            <p className="story-eyebrow">Live hold</p>
            <h2 id="hold-heading">The charge is a request. Approve is the apply.</h2>
            <p>
              Site tools, clicks, and screenshots hit the same glass. The page
              names the hand. Open the hold to read HLD-2207 and request $186.
            </p>
          </div>
          <Link className="charge-cta" href={HOLD_SANDBOX_PATH}>Open the live hold</Link>
        </section>

        <footer className="story-footer">
          <div>
            <strong>Callsmith</strong>
            <span>The page names the hand.</span>
          </div>
          <p>Synthetic data only · Test mode or no latch</p>
        </footer>
      </main>
    </>
  );
}
