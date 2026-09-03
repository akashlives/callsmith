# Devpost draft — Callsmith

## Tagline

**$186 charged on one website. $186 held for you on the other.**

## 1. Fit

WebMCP is a Community Group draft plus a Chrome 149–156 origin trial plus
ChatGPT Site tools (Sol/Terra). Shopify Liquid already shipped catalog / cart /
checkout. anthropics/commerce-agents (1 Sep): nothing charges a card; checkout
is a host handoff; entertainment has timed holds. ACP / UCP / AP2 settle
without a shared glass. Stripe MCP and Pipedream MCP are backends — they are
not mounted on `document.modelContext`.

Callsmith is the page that makes commerce-agents' rule true in the only client
judges will open, and proves which hand pressed charge. Site tools are how
ChatGPT / Codex should act. Computer-use and CDP still exist and will click.
The page makes Charge a request and Approve the only apply, so a Manus tab and
a Sol/Terra tab hit the same postcondition.

Start on the hold, not the homepage:

https://web-production-6cecc.up.railway.app/sandbox/ticketing-seats-boundary/safety-boundary

Sol/Terra only. Luna has Site tools disabled.

## 2. UX

One object. Money large. Fenced venue lie. Status chip. Approve is a button,
not a schema flag. Action ledger of which ingress fired. Click agents read the
same English. Home is the photograph: $186 charged vs $186 held. CTA: Open the
live hold.

## 3. Together

Model prepares. Person applies. Page names the actor. Optional test
PaymentIntent is the page's shadow of that apply — never a Site tool, never a
CDP-exposed secret.

## 4. Implementation

`document.modelContext.registerTool`; hints; fence; provenance; unregister +
`toolchange`; trust-checked Approve (rejects synthetic input, records actor;
does not claim agents cannot Approve); worker CDP screenshots; four suites
from one compiler, only ticketing sealed; page-owned test latch; evals on Luna;
judges on Sol/Terra. No `navigator.modelContext`. No Atlas. Origin trial +
Sol/Terra, not "live everywhere."

Hold tools: `read_hold`, `charge_hold`. Receipt JSON has no `frames` and no
`client_secret`. Same digest, web + worker. `webmcp-evals` 0.0.4.

## Required submission fields

- Submitter type: individual
- Country: **USER INPUT REQUIRED**
- App status: functioning prototype / newly built for this hackathon
- Live application: https://web-production-6cecc.up.railway.app/sandbox/ticketing-seats-boundary/safety-boundary
- Public MIT repository: https://github.com/akashlives/callsmith
- Agents/clients: ChatGPT in-app browser (Sol/Terra), WebMCP-enabled Chrome, Codex, Manus
- AI tools: OpenAI Responses API through the AI SDK, Codex
- Learning/career: built a shared glass for Site tools and click agents, with a named apply
- Public demo video with audio under 2:30: **hold URL first; narrated public URL pending submitter review and "yes, submit"**

## Demo video plan (≤2:30)

Do **not** click production Prove it again (paid Luna). Do not open on `/`.
No architecture diagram. No Luna on camera.

Suggested cut:

1. Hold URL first.
2. ~70s ticketing Site tools + Approve.
3. ~20s weak (`CHARGED · by the site`).
4. ~15s ledger / click contrast (Charge≠apply).
5. Remainder: photograph + hash if time.

Public YouTube URL stays empty until the submitter narrates and says
"yes, submit."

## Evidence to attach before submission freeze

- MIT license visible on the GitHub About panel;
- final production URL, repository revision, and container digest (web + worker, same);
- Site tools shots on the **hold URL**;
- public sub-2:30 narrated demo video (URL pending upload approval).

The project must not be created or updated on Devpost until the submitter
reviews these exact fields and confirms the missing country. Final submission
requires a second, explicit “yes, submit.”
