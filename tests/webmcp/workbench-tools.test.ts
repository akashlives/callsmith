import { afterEach, describe, expect, it, vi } from "vitest";

import { workbenchTools } from "@/components/webmcp-bridge";

describe("Callsmith WebMCP workbench tools", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts public evidence in preview mode and returns a shareable report", async () => {
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
      provenance: "preview",
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
});
