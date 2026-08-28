import { afterEach, describe, expect, it, vi } from "vitest";

import { workbenchTools } from "@/components/webmcp-bridge";

describe("Callsmith WebMCP workbench tools", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a compact suite catalog that an agent can use directly", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        suites: [
          {
            id: "sales-follow-through",
            version: "1.1.0",
            title: "Sales Follow-through Gauntlet",
            description: "Synthetic sales safety cases.",
            stateSchema: { large: "implementation detail" },
            tools: [{ name: "get_meeting_context" }],
            scenarios: [
              {
                id: "injection-confirmation",
                title: "Injection and confirmation boundary",
                goal: "Prepare a response without crossing the send boundary.",
                seed: 606,
                initialState: { large: "fixture detail" },
                assertions: [{ type: "state" }],
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = workbenchTools(vi.fn()).find(
      (candidate) => candidate.name === "list_suites",
    )!;
    const result = (await tool.execute(
      {},
      { signal: new AbortController().signal },
    )) as { content: Array<{ text: string }> };
    const catalog = JSON.parse(result.content[0].text) as Record<string, unknown>;

    expect(catalog).toEqual({
      suites: [
        {
          id: "sales-follow-through",
          version: "1.1.0",
          title: "Sales Follow-through Gauntlet",
          description: "Synthetic sales safety cases.",
          scenarios: [
            {
              id: "injection-confirmation",
              title: "Injection and confirmation boundary",
              goal: "Prepare a response without crossing the send boundary.",
              seed: 606,
            },
          ],
        },
      ],
    });
    expect(result.content[0].text).not.toContain("stateSchema");
    expect(result.content[0].text).not.toContain("assertions");
  });

  it("starts browser-native contract evidence and returns a shareable report", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: "run-judge" }, { status: 202 }))
      .mockResolvedValueOnce(
        Response.json({ token: "opaque-token", path: "/r/opaque-token" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const tool = workbenchTools(vi.fn()).find(
      (candidate) => candidate.name === "run_comparison",
    );
    expect(tool).toBeDefined();
    const result = await tool!.execute(
      {
        suiteId: "sales-follow-through",
        scenarioId: "injection-confirmation",
      },
      { signal: new AbortController().signal },
    );

    const createRequest = fetchMock.mock.calls[0];
    expect(createRequest?.[0]).toBe("/api/runs");
    expect(JSON.parse(String(createRequest?.[1]?.body))).toMatchObject({
      provenance: "browser_webmcp",
      models: ["gpt-5.6-luna"],
      contractVariants: ["weak", "hardened"],
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/runs/run-judge/share");
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            run: { id: "run-judge" },
            report: { token: "opaque-token", path: "/r/opaque-token" },
          }),
        },
      ],
    });
  });

  it("polls a terminal run and opens its read-only report capability", async () => {
    const openReport = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        id: "run-agent-journey",
        status: "completed",
        evidenceStatus: "conclusive",
        attempts: [{ provenance: "browser_webmcp" }],
        shareToken: "agent-report-token-123456",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tools = workbenchTools(openReport);

    const statusTool = tools.find((candidate) => candidate.name === "get_run_status")!;
    const status = await statusTool.execute(
      { runId: "run-agent-journey" },
      { signal: new AbortController().signal },
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-agent-journey", {
      signal: expect.any(AbortSignal),
    });
    const statusText = (
      status as { content: Array<{ type: string; text: string }> }
    ).content[0].text;
    expect(JSON.parse(statusText)).toMatchObject({
      status: "completed",
      evidenceStatus: "conclusive",
      shareToken: "agent-report-token-123456",
      attempts: [{ provenance: "browser_webmcp" }],
    });

    const openTool = tools.find((candidate) => candidate.name === "open_report")!;
    expect(
      await openTool.execute(
        { token: "agent-report-token-123456" },
        { signal: new AbortController().signal },
      ),
    ).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            opened: true,
            path: "/r/agent-report-token-123456",
          }),
        },
      ],
    });
    expect(openReport).toHaveBeenCalledWith("/r/agent-report-token-123456");
  });

  it("returns API failures as evidence instead of throwing through WebMCP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({ error: "Run not found" }, { status: 404 }),
      ),
    );
    const tool = workbenchTools(vi.fn()).find(
      (candidate) => candidate.name === "get_run_status",
    )!;

    const result = (await tool.execute(
      { runId: "missing-run" },
      { signal: new AbortController().signal },
    )) as { content: Array<{ text: string }> };

    expect(JSON.parse(result.content[0].text)).toEqual({
      ok: false,
      status: "request_failed",
      code: "callsmith_request_failed",
      message: "Run not found",
    });
  });

  it("supports Chrome Inspector calls that omit the execution context", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ suites: [] }))
      .mockResolvedValueOnce(Response.json({ id: "run-inspector" }, { status: 202 }))
      .mockResolvedValueOnce(
        Response.json({ token: "inspector-report-token", path: "/r/inspector-report-token" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "run-inspector",
          status: "completed",
          evidenceStatus: "conclusive",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const tools = workbenchTools(vi.fn());
    const inspectorExecute = (name: string) =>
      tools.find((candidate) => candidate.name === name)!.execute as (
        input: Record<string, unknown>,
      ) => Promise<unknown>;

    await expect(inspectorExecute("list_suites")({})).resolves.toBeDefined();
    await expect(
      inspectorExecute("run_comparison")({
        suiteId: "sales-follow-through",
        scenarioId: "injection-confirmation",
      }),
    ).resolves.toBeDefined();
    const status = (await inspectorExecute("get_run_status")({
      runId: "run-inspector",
    })) as { content: Array<{ text: string }> };

    expect(JSON.parse(status.content[0].text)).toMatchObject({
      id: "run-inspector",
      status: "completed",
      evidenceStatus: "conclusive",
    });
    expect(fetchMock.mock.calls.every((call) => call[1]?.signal instanceof AbortSignal)).toBe(
      true,
    );
  });
});
