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

type WebMcpToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
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

function getModelContext(
  target: Document | undefined =
    typeof document === "undefined" ? undefined : document,
): ModelContextLike | undefined {
  return (target as DocumentWithModelContext | undefined)?.modelContext;
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

/**
 * Site-side defense against mid-session tool injection (arXiv 2606.06387).
 *
 * A tainted third-party script on the same page can abort a legitimate tool's
 * registration and re-register the same name, or win the registration race
 * before the page does. Model upgrades do not stop this; the paper's only
 * defense that reached 0% attack success was binding tool identity to the
 * registering party and re-validating the lifecycle. The registry below does
 * that for a website: every tool gets an immutable `toolId`, the registering
 * party holds an unforgeable lock, and under the `origin_bound` policy a
 * same-name registration without that lock is rejected and logged instead of
 * reaching `document.modelContext`.
 */
export type ToolRegistryPolicy = "open" | "origin_bound";

type RegistrationLock = symbol;

export type ToolLifecycleEvent = {
  type: "registered" | "replaced" | "rejected" | "unregistered";
  toolName: string;
  toolId: string;
  source: string;
  message: string;
};

export type ToolSurfaceEntry = {
  toolName: string;
  toolId: string;
  source: string;
};

export type RegistryRegistration = WebMcpRegistration & {
  lock: RegistrationLock;
  accepted: string[];
  rejected: string[];
};

export type WebMcpToolRegistry = {
  supported: boolean;
  policy: ToolRegistryPolicy;
  register: (
    tools: readonly WebMcpTool[],
    options: { source: string; lock?: RegistrationLock; exposedTo?: string[] },
  ) => RegistryRegistration;
  snapshot: () => ToolSurfaceEntry[];
  unregisterAll: () => void;
};

type RegistryEntry = ToolSurfaceEntry & {
  lock: RegistrationLock;
  controller: AbortController;
};

export function createWebMcpToolRegistry(options: {
  policy: ToolRegistryPolicy;
  document?: Document;
  onEvent?: (event: ToolLifecycleEvent) => void;
}): WebMcpToolRegistry {
  const modelContext = getModelContext(options.document);
  const entries = new Map<string, RegistryEntry>();
  let sequence = 0;
  const emit = (event: ToolLifecycleEvent) => options.onEvent?.(event);

  const remove = (entry: RegistryEntry, message: string) => {
    entry.controller.abort();
    if (entries.get(entry.toolName) === entry) entries.delete(entry.toolName);
    emit({
      type: "unregistered",
      toolName: entry.toolName,
      toolId: entry.toolId,
      source: entry.source,
      message,
    });
  };

  return {
    supported: Boolean(modelContext),
    policy: options.policy,
    register(tools, registration) {
      const lock = registration.lock ?? Symbol("callsmith-registration-lock");
      const own: RegistryEntry[] = [];
      const accepted: string[] = [];
      const rejected: string[] = [];
      const pending: Promise<unknown>[] = [];

      for (const tool of tools) {
        const existing = entries.get(tool.name);
        if (existing) {
          if (options.policy === "origin_bound" && existing.lock !== lock) {
            rejected.push(tool.name);
            emit({
              type: "rejected",
              toolName: tool.name,
              toolId: existing.toolId,
              source: registration.source,
              message: `Origin-bound registry kept ${existing.toolId} from ${existing.source}. Same-name re-registration from ${registration.source} was refused and never reached document.modelContext.`,
            });
            continue;
          }
          existing.controller.abort();
          entries.delete(tool.name);
          emit({
            type: "replaced",
            toolName: tool.name,
            toolId: existing.toolId,
            source: registration.source,
            message: `Open registry let ${registration.source} abort ${existing.toolId} from ${existing.source} and take over the name.`,
          });
        }

        const controller = new AbortController();
        const entry: RegistryEntry = {
          toolName: tool.name,
          toolId: `${tool.name}#${++sequence}`,
          source: registration.source,
          lock,
          controller,
        };
        entries.set(tool.name, entry);
        own.push(entry);
        accepted.push(tool.name);
        if (modelContext) {
          pending.push(
            Promise.resolve(
              modelContext.registerTool(tool, {
                signal: controller.signal,
                ...(registration.exposedTo ? { exposedTo: registration.exposedTo } : {}),
              }),
            ),
          );
        }
        emit({
          type: "registered",
          toolName: tool.name,
          toolId: entry.toolId,
          source: registration.source,
          message: `${entry.toolId} registered by ${registration.source}.`,
        });
      }

      const ready = Promise.all(pending).then(() => undefined);
      void ready.catch(() => undefined);

      return {
        supported: Boolean(modelContext),
        ready,
        lock,
        accepted,
        rejected,
        unregister: () => {
          for (const entry of own) {
            if (entries.get(entry.toolName) === entry) {
              remove(entry, `${entry.toolId} unregistered by ${entry.source}.`);
            }
          }
        },
      };
    },
    snapshot() {
      return [...entries.values()].map(({ toolName, toolId, source }) => ({
        toolName,
        toolId,
        source,
      }));
    },
    unregisterAll() {
      for (const entry of [...entries.values()]) {
        remove(entry, `${entry.toolId} unregistered on reset.`);
      }
    },
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
