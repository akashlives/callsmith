/**
 * A deliberately small adapter for the experimental WebMCP browser API.
 *
 * Keeping the browser shape local means the rest of Callsmith remains usable in
 * browsers that do not expose `document.modelContext` yet. The types mirror the
 * current WebMCP draft without pretending the API is universally available.
 */

export type JsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [keyword: string]: unknown;
};

export type WebMcpToolAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
};

export type WebMcpExecuteOptions = {
  signal: AbortSignal;
};

export type WebMcpTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: WebMcpToolAnnotations;
  execute: (
    input: Record<string, unknown>,
    options?: WebMcpExecuteOptions,
  ) => unknown | Promise<unknown>;
};

type RegisterToolOptions = {
  signal?: AbortSignal;
  exposedTo?: string[];
};

export type ModelContextLike = EventTarget & {
  registerTool: (
    tool: WebMcpTool,
    options?: RegisterToolOptions,
  ) => void | Promise<void>;
};

type DocumentWithModelContext = Document & {
  modelContext?: ModelContextLike;
};

export type WebMcpRegistration = {
  supported: boolean;
  ready: Promise<void>;
  unregister: () => void;
};

export function getModelContext(
  target: Document | undefined =
    typeof document === "undefined" ? undefined : document,
): ModelContextLike | undefined {
  return (target as DocumentWithModelContext | undefined)?.modelContext;
}

export function isWebMcpSupported(target?: Document): boolean {
  return Boolean(getModelContext(target));
}

/**
 * Registers a group as one lifecycle unit. Aborting the returned controller is
 * the draft API's unregister mechanism, so dynamic React views cannot leak old
 * tools after a state or route transition.
 */
export function registerWebMcpTools(
  tools: readonly WebMcpTool[],
  options: { document?: Document; exposedTo?: string[] } = {},
): WebMcpRegistration {
  const modelContext = getModelContext(options.document);
  const controller = new AbortController();

  if (!modelContext) {
    return {
      supported: false,
      ready: Promise.resolve(),
      unregister: () => controller.abort(),
    };
  }

  const ready = Promise.all(
    tools.map((tool) =>
      Promise.resolve(
        modelContext.registerTool(tool, {
          signal: controller.signal,
          ...(options.exposedTo ? { exposedTo: options.exposedTo } : {}),
        }),
      ),
    ),
  ).then(() => undefined);

  // Registration failures are observable through `ready`; attach a handler so
  // an ignored promise does not create an unhandled rejection in normal React
  // cleanup paths.
  void ready.catch(() => undefined);

  return {
    supported: true,
    ready,
    unregister: () => controller.abort(),
  };
}

export function strictObjectSchema(
  properties: JsonSchema["properties"] = {},
  required: string[] = [],
): JsonSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export function asToolResult(data: unknown) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data),
      },
    ],
  };
}
