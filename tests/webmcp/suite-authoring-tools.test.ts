import { describe, expect, it, vi } from "vitest";

import { suiteAuthoringTools } from "@/components/suite-authoring-tools";

function parsedTextResult(result: unknown): Record<string, unknown> {
  const value = result as { content: Array<{ text: string }> };
  return JSON.parse(value.content[0].text) as Record<string, unknown>;
}

describe("Callsmith WebMCP suite authoring tools", () => {
  it("publishes the exact guided schema without an agent approval field", () => {
    const tools = suiteAuthoringTools(vi.fn());
    const author = tools.find((tool) => tool.name === "draft_and_run_suite");

    expect(author).toBeDefined();
    expect(author?.inputSchema.type).toBe("object");
    expect(author?.inputSchema.additionalProperties).toBe(false);
    expect(author?.inputSchema.required).toEqual(
      expect.arrayContaining([
        "draftVersion",
        "id",
        "version",
        "tools",
        "contractDesign",
        "expected",
      ]),
    );
    expect(author?.inputSchema.properties).not.toHaveProperty("approved");
    expect(author?.inputSchema.properties).not.toHaveProperty("confirmationToken");
  });

  it("returns authoring guidance without creating a draft", async () => {
    const requestReview = vi.fn();
    const guide = suiteAuthoringTools(requestReview).find(
      (tool) => tool.name === "get_authoring_guide",
    );
    const result = await guide?.execute({}, { signal: new AbortController().signal });

    expect(parsedTextResult(result)).toMatchObject({
      constraints: {
        syntheticDataOnly: true,
        executableContent: "not allowed",
      },
    });
    expect(requestReview).not.toHaveBeenCalled();
  });

  it("passes only the draft and abort signal into the human review boundary", async () => {
    const draft = {
      draftVersion: 1,
      id: "support-boundary",
      version: "1.0.0",
    };
    const requestReview = vi.fn().mockResolvedValue({
      ok: false,
      status: "rejected",
      code: "human_rejected",
      message: "The human rejected this suite. No run was created.",
    });
    const tool = suiteAuthoringTools(requestReview).find(
      (candidate) => candidate.name === "draft_and_run_suite",
    );
    const signal = new AbortController().signal;
    const result = await tool?.execute(draft, { signal });

    expect(requestReview).toHaveBeenCalledWith(draft, signal);
    expect(parsedTextResult(result)).toMatchObject({
      ok: false,
      status: "rejected",
      code: "human_rejected",
    });
  });
});
