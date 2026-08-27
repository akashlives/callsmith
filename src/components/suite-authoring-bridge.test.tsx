// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GuidedSuiteDraftSchema } from "@/lib/contracts";
import { compileGuidedSuiteDraft } from "@/lib/suite-compiler";
import type { ModelContextLike, WebMcpTool } from "@/lib/webmcp";
import supportFixture from "../../tests/fixtures/guided-suite/support.json";

import { SuiteAuthoringBridge } from "./suite-authoring-bridge";

const draft = GuidedSuiteDraftSchema.parse(supportFixture);
const compiledSuite = compileGuidedSuiteDraft(draft);

function resultBody(result: unknown) {
  const value = result as { content: Array<{ text: string }> };
  return JSON.parse(value.content[0].text) as Record<string, unknown>;
}

function creationResponse(expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return Response.json(
    {
      draft: {
        id: "draft-browser-review",
        status: "awaiting_confirmation",
        candidateSuite: compiledSuite,
      },
      ownerToken: "cs_owner_private",
      confirmationToken: "cs_confirm_private",
      confirmationExpiresAt: expiresAt,
      links: {
        approveAndRun: "/api/suite-drafts/draft-browser-review/approve-and-run",
        reject: "/api/suite-drafts/draft-browser-review/reject",
      },
    },
    { status: 201 },
  );
}

function registeredTools() {
  const tools = new Map<string, WebMcpTool>();
  const modelContext = Object.assign(new EventTarget(), {
    registerTool(tool: WebMcpTool) {
      tools.set(tool.name, tool);
    },
  }) as ModelContextLike;
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: modelContext,
  });
  return tools;
}

async function authoringTool(tools: Map<string, WebMcpTool>) {
  await waitFor(() => expect(tools.has("draft_and_run_suite")).toBe(true));
  return tools.get("draft_and_run_suite")!;
}

describe("suite authoring WebMCP bridge", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "modelContext");
  });

  it("holds the tool call for a human rejection and creates no run", async () => {
    const tools = registeredTools();
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/suite-drafts") return creationResponse();
      if (url.endsWith("/reject")) {
        return Response.json({ rejected: true, runCreated: false });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SuiteAuthoringBridge />);

    const tool = await authoringTool(tools);
    const pending = tool.execute(structuredClone(draft), {
      signal: new AbortController().signal,
    });
    expect(await screen.findByRole("dialog")).toHaveTextContent(draft.goal);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("approve-and-run"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Reject suite" }));
    const terminal = resultBody(await pending);
    expect(terminal).toMatchObject({
      ok: false,
      status: "rejected",
      code: "human_rejected",
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/reject"))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("approve-and-run"))).toBe(false);
  });

  it("starts exactly one comparison after the human approves", async () => {
    const tools = registeredTools();
    let finishApproval!: () => void;
    const approvalGate = new Promise<void>((resolve) => {
      finishApproval = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/suite-drafts") return creationResponse();
      if (url.endsWith("/approve-and-run")) {
        await approvalGate;
        expect(init?.headers).toMatchObject({
          authorization: "Bearer cs_owner_private",
          "x-callsmith-confirmation-token": "cs_confirm_private",
        });
        return Response.json(
          { run: { id: "run-human-approved", status: "queued" } },
          { status: 202 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SuiteAuthoringBridge />);

    const tool = await authoringTool(tools);
    const pending = tool.execute(structuredClone(draft), {
      signal: new AbortController().signal,
    });
    await screen.findByRole("dialog");
    const approve = screen.getByRole("button", { name: "Approve suite" });
    fireEvent.click(approve);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approving…" })).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Approving…" }));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/approve-and-run"))).toHaveLength(1);

    await act(async () => finishApproval());
    expect(resultBody(await pending)).toMatchObject({
      ok: true,
      status: "approved",
      run: { runId: "run-human-approved", runStatus: "queued" },
    });
  });

  it("fails closed on agent abort and page navigation", async () => {
    for (const trigger of ["abort", "navigation"] as const) {
      cleanup();
      const tools = registeredTools();
      const fetchMock = vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url === "/api/suite-drafts") return creationResponse();
        if (url.endsWith("/reject")) return Response.json({ rejected: true });
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      render(<SuiteAuthoringBridge />);
      const tool = await authoringTool(tools);
      const controller = new AbortController();
      const pending = tool.execute(structuredClone(draft), { signal: controller.signal });
      await screen.findByRole("dialog");

      if (trigger === "abort") controller.abort();
      else window.dispatchEvent(new Event("pagehide"));

      expect(resultBody(await pending)).toMatchObject({
        ok: false,
        status: "aborted",
        code: trigger === "abort" ? "request_aborted" : "navigation",
      });
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/reject"))).toBe(true),
      );
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("approve-and-run"))).toBe(false);
    }
  });

  it("rejects fabricated approval and expires stale reviews without a run", async () => {
    const tools = registeredTools();
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/suite-drafts") {
        return creationResponse(new Date(Date.now() - 1_000).toISOString());
      }
      if (url.endsWith("/reject")) return Response.json({ rejected: true });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SuiteAuthoringBridge />);
    const tool = await authoringTool(tools);

    const fabricated = await tool.execute(
      { ...structuredClone(draft), approved: true },
      { signal: new AbortController().signal },
    );
    expect(resultBody(fabricated)).toMatchObject({
      ok: false,
      status: "invalid_request",
      code: "invalid_draft",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const stale = await tool.execute(structuredClone(draft), {
      signal: new AbortController().signal,
    });
    expect(resultBody(stale)).toMatchObject({
      ok: false,
      status: "stale_draft",
      code: "stale_draft",
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/reject"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("approve-and-run"))).toBe(false);
  });
});
