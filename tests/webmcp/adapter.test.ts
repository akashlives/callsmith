import { describe, expect, it, vi } from "vitest";

import {
  registerWebMcpTools,
  strictObjectSchema,
  type ModelContextLike,
  type WebMcpTool,
} from "@/lib/webmcp";

const tool: WebMcpTool = {
  name: "inspect_state",
  description: "Read isolated sandbox state.",
  inputSchema: strictObjectSchema(),
  annotations: { readOnlyHint: true },
  execute: () => ({ ok: true }),
};

describe("WebMCP browser adapter", () => {
  it("is a safe no-op when the browser does not expose modelContext", async () => {
    const registration = registerWebMcpTools([tool], {
      document: {} as Document,
    });

    expect(registration.supported).toBe(false);
    await expect(registration.ready).resolves.toBeUndefined();
    expect(() => registration.unregister()).not.toThrow();
  });

  it("registers tools as one abortable lifecycle", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    const modelContext = Object.assign(new EventTarget(), {
      registerTool,
    }) as ModelContextLike;

    const registration = registerWebMcpTools([tool], {
      document: { modelContext } as unknown as Document,
    });

    expect(registration.supported).toBe(true);
    await registration.ready;
    expect(registerTool).toHaveBeenCalledOnce();
    expect(registerTool.mock.calls[0]?.[0]).toBe(tool);

    const signal = registerTool.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    registration.unregister();
    expect(signal.aborted).toBe(true);
  });

  it("builds closed object schemas", () => {
    expect(
      strictObjectSchema(
        { id: { type: "string", description: "Record id." } },
        ["id"],
      ),
    ).toEqual({
      type: "object",
      properties: { id: { type: "string", description: "Record id." } },
      required: ["id"],
      additionalProperties: false,
    });
  });
});
