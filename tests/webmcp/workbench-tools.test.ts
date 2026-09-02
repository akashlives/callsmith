import { afterEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAFETY_CONTRACT } from "@/lib/canonical-contract";
import { workbenchTools } from "@/components/webmcp-bridge";

function text(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe("Callsmith WebMCP safety tools", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exposes exactly five compact tools within Chrome guidance budgets", async () => {
    const tools = workbenchTools(vi.fn());
    expect(tools.map((tool) => tool.name)).toEqual([
      "get_contract_template",
      "propose_safety_contract",
      "get_callsmith_status",
      "run_decisive_case",
      "open_evidence_receipt",
    ]);
    for (const tool of tools) {
      expect(tool.description.length).toBeLessThanOrEqual(500);
    }
    expect(tools.map((tool) => tool.annotations)).toEqual([
      { readOnlyHint: true, destructiveHint: false, untrustedContentHint: false },
      { readOnlyHint: false, destructiveHint: true, untrustedContentHint: false },
      { readOnlyHint: true, destructiveHint: false, untrustedContentHint: false },
      { readOnlyHint: false, destructiveHint: true, untrustedContentHint: false },
      { readOnlyHint: true, destructiveHint: false, untrustedContentHint: false },
    ]);

    const template = await tools[0].execute({});
    expect(new TextEncoder().encode(JSON.stringify(text(template))).byteLength).toBeLessThanOrEqual(1_500);
    expect(text(template)).toMatchObject({ ok: true, limits: { bytes: 8192 } });
  });

  it("starts only the fixed browser-native decisive case", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          experiment: { id: "experiment-judge", status: "queued" },
          accessToken: "read-capability",
          receiptToken: "receipt-capability",
          links: { receipt: "/r/receipt-capability" },
        },
        { status: 202 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tool = workbenchTools(vi.fn()).find(
      (candidate) => candidate.name === "run_decisive_case",
    )!;
    const result = await tool.execute({});

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/experiments",
      expect.objectContaining({ method: "POST", body: "{}", signal: expect.any(AbortSignal) }),
    );
    expect(text(result)).toEqual({
      ok: true,
      experimentId: "experiment-judge",
      status: "queued",
      statusCapability: "read-capability",
      receiptToken: "receipt-capability",
      receiptPath: "/r/receipt-capability",
    });
  });

  it("returns from proposal creation before the human decision", async () => {
    const onProposalCreated = vi.fn();
    const proposalResponse = {
      operation: {
        operationId: "proposal-one",
        status: "awaiting_review",
        expiresAt: "2026-08-28T21:00:00.000Z",
      },
      review: {
        draft: CANONICAL_SAFETY_CONTRACT,
        protectedState: { path: "followups.0.status", safeValue: "draft", unsafeValue: "sent" },
        prompt: CANONICAL_SAFETY_CONTRACT.goal,
        expectedCalls: [],
      },
      privateCapabilities: { ownerToken: "owner", decisionToken: "decision" },
      statusCapability: "status-capability",
      links: { status: "/status", decision: "/decision" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(proposalResponse, { status: 201 })),
    );
    const tool = workbenchTools(vi.fn(), { onProposalCreated }).find(
      (candidate) => candidate.name === "propose_safety_contract",
    )!;

    const result = await tool.execute(CANONICAL_SAFETY_CONTRACT);

    expect(onProposalCreated).toHaveBeenCalledWith(proposalResponse);
    expect(text(result)).toEqual({
      ok: true,
      operationId: "proposal-one",
      status: "awaiting_review",
      statusCapability: "status-capability",
      expiresAt: "2026-08-28T21:00:00.000Z",
      message: "Human review opened. Poll status; do not attempt to approve through a tool.",
    });
    expect(JSON.stringify(text(result))).not.toContain("decision");
    expect(JSON.stringify(text(result))).not.toContain("owner");
  });

  it("reads compact authenticated status and opens receipts", async () => {
    const open = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({ id: "experiment-one", status: "completed", receiptAvailable: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tools = workbenchTools(open);
    const status = await tools
      .find((tool) => tool.name === "get_callsmith_status")!
      .execute({ kind: "experiment", operation_id: "experiment-one", capability: "read-token" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/experiments/experiment-one",
      expect.objectContaining({
        headers: { authorization: "Bearer read-token" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(text(status)).toMatchObject({ ok: true, status: { status: "completed" } });

    const opened = await tools
      .find((tool) => tool.name === "open_evidence_receipt")!
      .execute({ token: "receipt-token" });
    expect(open).toHaveBeenCalledWith("/r/receipt-token");
    expect(text(opened)).toMatchObject({ ok: true, opened: true });
  });

  it("turns API failures into bounded tool results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({ error: "Experiment not found" }, { status: 404 }),
      ),
    );
    const tool = workbenchTools(vi.fn()).find(
      (candidate) => candidate.name === "get_callsmith_status",
    )!;
    const result = await tool.execute({
      kind: "experiment",
      operation_id: "missing",
      capability: "wrong",
    });
    expect(text(result)).toEqual({
      ok: false,
      code: "callsmith_request_failed",
      message: "Experiment not found",
    });
  });
});
