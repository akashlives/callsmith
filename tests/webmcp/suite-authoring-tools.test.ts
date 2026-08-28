import { describe, expect, it, vi } from "vitest";

import { suiteAuthoringTools } from "@/components/suite-authoring-tools";

function parsedTextResult(result: unknown): Record<string, unknown> {
  const value = result as { content: Array<{ text: string }> };
  return JSON.parse(value.content[0].text) as Record<string, unknown>;
}

describe("Callsmith WebMCP suite authoring tools", () => {
  it("publishes a compact cross-agent schema without an approval field", () => {
    const tools = suiteAuthoringTools(vi.fn());
    const author = tools.find((tool) => tool.name === "draft_and_run_suite");

    expect(author).toBeDefined();
    expect(author?.inputSchema.type).toBe("object");
    expect(author?.inputSchema.additionalProperties).toBe(false);
    expect(author?.inputSchema.required).toEqual(["draftJson"]);
    expect(author?.inputSchema.properties).toHaveProperty("draftJson");
    expect(author?.inputSchema.properties).not.toHaveProperty("approved");
    expect(author?.inputSchema.properties).not.toHaveProperty("confirmationToken");
    expect(JSON.stringify(author?.inputSchema).length).toBeLessThan(1_000);
    expect(JSON.stringify(author?.inputSchema)).not.toMatch(
      /\"(?:\$ref|definitions|oneOf|anyOf|allOf|const)\"/,
    );
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
      starterDraft: {
        domain: "support",
        contractDesign: {
          consequentialMutationTool: "escalate_ticket",
        },
      },
    });
    expect(JSON.stringify(parsedTextResult(result)).length).toBeLessThan(10_000);
    expect(requestReview).not.toHaveBeenCalled();
  });

  it("supports Chrome Inspector calls that omit the execution context", async () => {
    const requestReview = vi.fn().mockResolvedValue({
      ok: false,
      status: "rejected",
      code: "human_rejected",
      message: "The human rejected this suite.",
    });
    const guide = suiteAuthoringTools(vi.fn()).find(
      (tool) => tool.name === "get_authoring_guide",
    );
    const starter = parsedTextResult(
      await guide?.execute({}, { signal: new AbortController().signal }),
    ).starterDraft;
    const tool = suiteAuthoringTools(requestReview).find(
      (candidate) => candidate.name === "draft_and_run_suite",
    );

    const inspectorExecute = tool?.execute as (
      input: Record<string, unknown>,
    ) => Promise<unknown>;
    const result = await inspectorExecute({
      draftJson: JSON.stringify(starter),
    });

    expect(requestReview).toHaveBeenCalledWith(starter, expect.any(AbortSignal));
    expect(parsedTextResult(result)).toMatchObject({
      status: "rejected",
      code: "human_rejected",
    });
  });

  it("returns exact field paths instead of throwing for an invalid agent draft", async () => {
    const requestReview = vi.fn();
    const guide = suiteAuthoringTools(vi.fn()).find(
      (tool) => tool.name === "get_authoring_guide",
    );
    const starter = structuredClone(
      parsedTextResult(
        await guide?.execute({}, { signal: new AbortController().signal }),
      ).starterDraft,
    ) as Record<string, unknown>;
    const tools = starter.tools as Array<Record<string, unknown>>;
    const action = tools[0].action as Record<string, unknown>;
    action.idArgument = "ticketId";
    const tool = suiteAuthoringTools(requestReview).find(
      (candidate) => candidate.name === "draft_and_run_suite",
    );

    const result = parsedTextResult(
      await tool?.execute(
        { draftJson: JSON.stringify(starter) },
        { signal: new AbortController().signal },
      ),
    );

    expect(result).toMatchObject({
      status: "invalid_request",
      code: "invalid_draft",
      issues: expect.arrayContaining([
        {
          path: "tools.0.action.idArgument",
          message: "Use lowercase letters, numbers, and underscores",
        },
      ]),
    });
    expect(requestReview).not.toHaveBeenCalled();
  });

  it("passes only the draft and abort signal into the human review boundary", async () => {
    const guide = suiteAuthoringTools(vi.fn()).find(
      (tool) => tool.name === "get_authoring_guide",
    );
    const draft = parsedTextResult(await guide?.execute({}, {
      signal: new AbortController().signal,
    })).starterDraft as Record<string, unknown>;
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
    const result = await tool?.execute(
      { draftJson: JSON.stringify(draft) },
      { signal },
    );

    expect(requestReview).toHaveBeenCalledWith(draft, signal);
    expect(parsedTextResult(result)).toMatchObject({
      ok: false,
      status: "rejected",
      code: "human_rejected",
    });
  });

  it("returns an actionable error for malformed draft JSON", async () => {
    const requestReview = vi.fn();
    const tool = suiteAuthoringTools(requestReview).find(
      (candidate) => candidate.name === "draft_and_run_suite",
    );
    const result = await tool?.execute(
      { draftJson: "{not-json" },
      { signal: new AbortController().signal },
    );

    expect(parsedTextResult(result)).toMatchObject({
      ok: false,
      status: "invalid_request",
      code: "invalid_draft_json",
    });
    expect(requestReview).not.toHaveBeenCalled();
  });
});
