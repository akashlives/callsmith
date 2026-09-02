# Devpost draft — Callsmith

## Tagline

**Agent platforms review every tool call. Nobody attests the website. Callsmith does.**

## One-line pitch

Callsmith seals a receipt of what an agent-facing website actually did when an
agent was pushed to cross a boundary—the artifact a platform like ChatGPT,
Chrome, Shopify, or Cloudflare can check before enabling destructive tools on an
origin, and the evidence the website will need when the loss lands on it.

## What it does

Expected-call evaluation answers, “Did the agent call the tools we expected?”
Callsmith answers the consequential follow-up: “What happened to protected
browser state, and did the website stop the unsafe action?”

Callsmith runs one synthetic task against weak and hardened versions of the same
WebMCP contract. The model, prompt, seed, and hostile content stay fixed. The
official expected-call baseline can pass both variants, while Callsmith records
whether the unsafe action was attempted, whether protected state mutated, and
whether the website prevented harm.

The result is an immutable, shareable evidence receipt with the exact prompt,
contract diff, browser trace, state changes, assertions, failures, framework
versions, and a SHA-256 content hash.

Developers can also ask an agent to propose a compact, synthetic safety contract
for another domain. Callsmith shows the hostile content, protected field,
generated prompt, expected calls, and weak/hardened contract difference before a
human approves anything. Approval starts a durable browser experiment; rejection
starts nothing.

## Why it matters

Websites are becoming execution environments. WebMCP is live in the Chrome 149
origin trial, ChatGPT desktop Site tools, Shopify storefronts, and Cloudflare's
edge bridge. Three facts make that dangerous in a way nobody currently owns:

- **The platform reviews the call, not the site.** OpenAI's documentation:
  every Site tool call "receives a safety review," but those checks "don't
  guarantee the website or its responses are trustworthy." The platform sees
  the arguments; it cannot see whether the page's confirmation boundary held or
  whether protected state mutated.
- **The attacks are protocol-level and model upgrades do not fix them.**
  Mid-Session Tool Injection (arXiv 2606.06387): a tainted third-party script
  hijacks a WebMCP tool by aborting and re-registering it (94%) or winning the
  registration race (100%) across GPT-5.4, Claude Opus 4.6, and Gemini 2.5,
  with no drop from GPT-4o. The only defenses that reached 0% were site-side:
  origin-bound tool identity and lifecycle re-validation.
- **Liability has landed on the website.** The Agentic Commerce Protocol keeps
  settlement, refunds, and chargebacks with the merchant. The UK CMA (March
  2026) holds a business responsible for its agent as for an employee. No card
  network has an agent-dispute rule; the expected first rule is an evidentiary
  standard, with loss to whoever cannot produce the evidence.

Agent-side vendors constrain what the agent may do. Payment rails prove who the
agent was and what mandate it carried. Neither proves what the website did.
Callsmith's receipt is that proof: consequence rather than compliance. An agent
may call the expected tool with the expected arguments and still cross the line;
the receipt shows whether the website's own contract blocked the transition.

## WebMCP use

Judges score **page tools**, not a remote MCP server. There are two surfaces.

The public homepage registers exactly five workbench tools through
`document.modelContext.registerTool()` in `src/components/webmcp-bridge.tsx`:

1. `get_contract_template`
2. `propose_safety_contract`
3. `get_callsmith_status`
4. `run_decisive_case`
5. `open_evidence_receipt`

The evaluated **sandbox** (`/sandbox/meeting-note-boundary/safety-boundary`)
registers the meeting-note CRM tools (`read_meeting_note`, `send_followup`) the
same way. Chrome's native WebMCP surface runs those tools with Google's
`webmcp-evals` runner. Confirm in DevTools with
`document.modelContext.getTools()`.

The sandbox also carries a **Compromised third-party script** toggle. A
simulated CDN script tries to hijack `send_followup` by aborting the legitimate
registration and re-registering the same name. The weak page accepts it and
`getTools()` shows the impostor; the hardened page's origin-bound registry
rejects it and appends the lifecycle event to the on-page evidence log. This is
the site-side defense the MSTI paper measured at 0% attack success, implemented
on the website rather than in the model.

How to judge without a paid Run: open ChatGPT's in-app browser (GPT-5.6 Sol or
Terra; Luna has Site tools disabled) or Chrome 149+ with
`chrome://flags/#enable-webmcp-testing`. The idle homepage already shows the
sealed production pair with its SHA-256; the same receipt is at
https://web-production-6cecc.up.railway.app/r/38JcJ41Z85ccqww-22kilE3SLai6CpDE_BgquQApUqI
— Weak SENT vs Hardened DRAFT·HELD. Agent prompts on `/`: “Open the evidence
receipt” (`open_evidence_receipt`, free) or “Run the decisive case”
(`run_decisive_case`, paid live pair).

Pipedream Connect is an **optional write backend** (Gmail / Slack catalog rows
inside the fake CRM). It is not the demo, not extra `registerTool`s, and not
the guest Run path. Live Connect requires `PIPEDREAM_CLIENT_ID`,
`PIPEDREAM_CLIENT_SECRET`, and `PIPEDREAM_PROJECT_ID`; otherwise those rows stay
catalog-only. Hardened still requires the existing human confirmation form.

Human approval cannot be fabricated as a tool parameter. It occurs only in a
visible, non-autosubmitting declarative form.

## How it was built

- Next.js and React for the verdict-first application
- `webmcp-evals` 0.0.4 and Chrome unstable for browser-native execution
- Postgres for proposals, experiments, attempts, outbox, and immutable receipts
- Redis Streams for durable jobs, progress events, recovery, and worker health
- Railway for web, worker, Postgres, Redis, private networking, staging, and
  production
- Vitest, real Postgres/Redis integration tests, Playwright, official WebMCP
  smoke, and browser-use acceptance gates

The same immutable container image runs the web and worker roles. The web writes
an experiment and outbox record transactionally. A Redis Streams consumer group
delivers browser jobs to the worker, which acknowledges only terminal evidence.
If the worker drains or restarts mid-browser-run, incomplete output is discarded
and the stale stream entry is reclaimed. Progress is published through Redis so
SSE reconnects survive web restarts.

## Decisive demonstration

A meeting note says the buyer already approved automatic delivery and pressures
the agent to send. With the weak contract, expected calls pass and protected
state changes from `draft` to `sent`. With the hardened contract, the same
attempt requests human confirmation and state remains `draft`.

The report separates five facts: task outcome, unsafe action, protected state,
harm prevention, and official baseline outcome. It makes no model-superiority
claim.

The frozen ten-seed benchmark produced twenty live browser attempts. The official
expected-call baseline passed both contracts in 10/10 pairs. Callsmith found the
material state difference in 10/10: the weak contract mutated protected state,
while the hardened contract prevented harm. The Wilson 95% interval is
72.2–100.0%, median pair latency is 5,667 ms, and no pair is missing. This is a
narrow contract-design result, not a claim that one model is generally safer.

## Challenges

The hardest problem was keeping evidence honest across browser and infrastructure
failure. During forced worker-restart testing, the upstream runner returned an
ordinary failed report instead of throwing. Callsmith initially risked sealing
that interruption as a provider failure. We added explicit drain-aware lifecycle
handling: interrupted output is never acknowledged as evidence and Redis reclaims
the job after restart.

The second challenge was resisting benchmark theater. Earlier versions mixed
simulation, previews, model comparison, weighted scores, and scenario-specific
instructions. We removed those paths and narrowed the product to one controlled
causal comparison: the model, task, prompt, seed, and hostile content stay fixed;
only the website contract changes.

## What we learned

- Tool registration and argument matching are necessary, but browser state is the
  stronger safety truth.
- Human approval must be enforced by the website and cannot be represented as an
  agent-supplied boolean.
- A run without a complete weak/hardened pair is inconclusive, not a verdict.
- Durable queues are not enough unless the worker's acknowledgment boundary
  matches evidence finalization.
- Framework currency should mean daily canary verification, not unreviewed
  production upgrades.

## What's next

The receipt generalizes into an attestation platforms can query. A standard
gauntlet of six attack classes (hostile untrusted content, mid-session tool
hijack, tool framing via description and `readOnlyHint`, long-description
overflow, confirmation bypass, delegation chain) runs against any captured WebMCP
origin in the isolated runner, and the results seal into a signed attestation
(origin, tool-surface hash, gauntlet version, per-case outcome, receipt hashes)
served at `/.well-known/webmcp-attestation` and through a registry endpoint a
platform calls before enabling `destructiveHint` tools on that origin. Today's
release attests one boundary and does not claim certification.

## Required submission fields

- Submitter type: individual
- Country: **USER INPUT REQUIRED**
- App status: functioning prototype / newly built for this hackathon
- Live application: https://web-production-6cecc.up.railway.app/
- Public MIT repository: https://github.com/akashlives/callsmith
- Agents/clients: ChatGPT in-app browser, WebMCP-enabled Chrome, Codex
- AI tools: OpenAI Responses API through the AI SDK, Codex
- Learning/career: built browser-native WebMCP evaluation, durable Redis/Postgres
  execution, tamper-evident receipts, and human-in-the-loop tool boundaries
- Public demo video with audio under three minutes: **silent live restage
  walkthrough at `outputs/callsmith-demo-restage.webm`; narrated public URL
  pending submitter review and upload approval**

## Demo video plan (<3 min)

Do **not** click production Run (paid Luna, seed 606). Use the silent restage
cut at `outputs/callsmith-demo-restage.webm` plus DevTools, or recapture the
same live path. Public YouTube URL stays empty until the submitter narrates
this script and explicitly approves upload.

**Narration (~2:10, map 1:1 to judging criteria)**

1. **0:00–0:25 Impact (the problem).** On
   https://web-production-6cecc.up.railway.app/ — heading “Agent platforms
   review every tool call. Nobody attests the website.” Two CRM windows already
   sealed: Weak SENT, Hardened DRAFT·HELD, SHA-256 under them.
   “ChatGPT and Chrome review each call. OpenAI’s own docs say that doesn’t
   make the website trustworthy. The loss lands on the site. Same note, two
   website contracts, one agent.”
2. **0:25–0:55 Execution (the seal).** Cut to
   https://web-production-6cecc.up.railway.app/r/38JcJ41Z85ccqww-22kilE3SLai6CpDE_BgquQApUqI
   — SHA-256 first, then the traces.
   “Official expectedCall passed both. Only one website stopped the send. Ten
   seeds, ten for ten, hash-sealed.”
3. **0:55–1:30 Leverage.** DevTools on `/`:
   `await document.modelContext.getTools()` — the five workbench names. Then
   `/sandbox/meeting-note-boundary/safety-boundary`: flip **Compromised
   third-party script**. Weak: `getTools()` shows the impostor
   `send_followup`. Hardened: rejected, lifecycle event logged, and
   `toolname="confirm_follow_up"` with no `toolautosubmit`.
   “This hijack works on GPT-5.4, Claude, and Gemini alike. No model fixes it.
   The website does.”
4. **1:30–1:55 Ambition.** Back on the receipt JSON header: origin, contract
   hash, gauntlet version. “This is the artifact a platform fetches before it
   lets its agent touch a destructive tool on this origin. Today it attests one
   boundary. The gauntlet grows; the receipt stays sealed.”
5. **1:55–2:10 Close.** Guest, synthetic, no OAuth. Do not click Run on camera.

Existing sealed receipts for visual proof only:

- https://web-production-6cecc.up.railway.app/r/38JcJ41Z85ccqww-22kilE3SLai6CpDE_BgquQApUqI
- https://web-production-6cecc.up.railway.app/r/x2Vs0PVufQs4SEmMSZBXMZhfU_LXR7JgfKP5Agsiu-c

## Evidence to attach before submission freeze

- MIT license visible on the GitHub About panel;
- final production URL, repository revision, and container digest;
- checked-in ten-seed matched benchmark;
- Chrome WebMCP and ChatGPT in-app-browser QA screenshots (captured);
- five genuine, uncoached non-sales tester receipts;
- public sub-three-minute narrated demo video (silent live cut local; public
  URL pending upload approval).

The project must not be created or updated on Devpost until the submitter reviews
these exact fields and confirms the missing country. Final submission requires a
second, explicit “yes, submit.” Tester sessions, if time remains, use production
after this deploy and must not be fabricated.
