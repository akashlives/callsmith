"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import {
  asToolResult,
  registerWebMcpTools,
  strictObjectSchema,
  type WebMcpExecuteOptions,
  type WebMcpTool,
} from "@/lib/webmcp";

async function readJson(response: Response) {
  const data: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof data === "object" && data && "error" in data
        ? String(data.error)
        : `Callsmith request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failedToolResult(error: unknown) {
  return asToolResult({
    ok: false,
    status: "request_failed",
    code: "callsmith_request_failed",
    message: messageFromUnknown(error),
  });
}

/** Chrome's WebMCP Inspector invokes tools without the optional execution
 * context used by agent runtimes. Keep cancellation when it is available,
 * while making manual Inspector verification exercise the same real APIs. */
function executionSignal(options?: WebMcpExecuteOptions): AbortSignal {
  return options?.signal ?? new AbortController().signal;
}

/** Keep discovery useful to an agent without returning every state fixture,
 * trace assertion, and tool implementation in the hosted definitions. */
function compactSuiteCatalog(data: unknown): unknown {
  if (!data || typeof data !== "object" || !("suites" in data)) return data;
  const suites = (data as { suites?: unknown }).suites;
  if (!Array.isArray(suites)) return data;

  return {
    suites: suites.map((suite) => {
      const record = suite as Record<string, unknown>;
      const scenarios = Array.isArray(record.scenarios) ? record.scenarios : [];
      return {
        id: record.id,
        version: record.version,
        title: record.title,
        description: record.description,
        scenarios: scenarios.map((scenario) => {
          const item = scenario as Record<string, unknown>;
          return {
            id: item.id,
            title: item.title,
            goal: item.goal,
            seed: item.seed,
          };
        }),
      };
    }),
  };
}

export function workbenchTools(openReport: (path: string) => void): readonly WebMcpTool[] {
  return [
  {
    name: "list_suites",
    title: "List Callsmith suites",
    description:
      "List the safe, hosted WebMCP reliability suites and scenarios available in Callsmith.",
    inputSchema: strictObjectSchema(),
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    async execute(_input, options?: WebMcpExecuteOptions) {
      try {
        const signal = executionSignal(options);
        const response = await fetch("/api/suites", { signal });
        return asToolResult(compactSuiteCatalog(await readJson(response)));
      } catch (error) {
        return failedToolResult(error);
      }
    },
  },
  {
    name: "run_comparison",
    title: "Run a reliability comparison",
    description:
      "Start an isolated Callsmith comparison for a hosted suite. This creates a run but never performs a consequential CRM action.",
    inputSchema: strictObjectSchema(
      {
        suiteId: {
          type: "string",
          description: "Hosted suite identifier.",
        },
        scenarioId: {
          type: "string",
          description: "Scenario identifier within the suite.",
        },
        models: {
          type: "array",
          items: { type: "string", enum: ["gpt-5.6-luna", "gpt-5.6-terra"] },
          minItems: 1,
          maxItems: 2,
          description: "Optional model selection. The signature case uses one model.",
        },
        contractVariants: {
          type: "array",
          items: { type: "string", enum: ["weak", "hardened"] },
          minItems: 1,
          maxItems: 2,
          description: "Website contracts to compare using the same model and seed.",
        },
        repetitions: {
          type: "integer",
          minimum: 1,
          maximum: 3,
          description: "Attempts per model.",
        },
        seed: {
          type: "integer",
          minimum: 0,
          description: "Deterministic scenario seed.",
        },
        provenance: {
          type: "string",
          enum: [
            "browser_webmcp",
            "server_simulation",
            "deterministic_preview",
          ],
          description:
            "Execution surface. Browser WebMCP is the default; fallbacks remain explicitly labeled.",
        },
      },
      ["suiteId", "scenarioId"],
    ),
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input, options?: WebMcpExecuteOptions) {
      try {
        const signal = executionSignal(options);
        const response = await fetch("/api/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...input,
            models: input.models ?? ["gpt-5.6-luna"],
            contractVariants: input.contractVariants ?? ["weak", "hardened"],
            provenance: input.provenance ?? "browser_webmcp",
          }),
          signal,
        });
        const run = (await readJson(response)) as { id?: unknown };
        if (typeof run.id !== "string") return asToolResult({ run });

        const shareResponse = await fetch(
          `/api/runs/${encodeURIComponent(run.id)}/share`,
          {
            method: "POST",
            signal,
          },
        );
        const report = await readJson(shareResponse);
        return asToolResult({ run, report });
      } catch (error) {
        return failedToolResult(error);
      }
    },
  },
  {
    name: "get_run_status",
    title: "Get run status",
    description:
      "Read the current status, completed attempts, scores, failure details, and read-only report share token for a Callsmith run.",
    inputSchema: strictObjectSchema(
      {
        runId: { type: "string", description: "Callsmith run identifier." },
      },
      ["runId"],
    ),
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    async execute({ runId }, options?: WebMcpExecuteOptions) {
      try {
        const signal = executionSignal(options);
        const response = await fetch(
          `/api/runs/${encodeURIComponent(String(runId))}`,
          { signal },
        );
        return asToolResult(await readJson(response));
      } catch (error) {
        return failedToolResult(error);
      }
    },
  },
  {
    name: "open_report",
    title: "Open a shared reliability report",
    description:
      "Open an existing unlisted, read-only Callsmith report by its opaque share token.",
    inputSchema: strictObjectSchema(
      {
        token: {
          type: "string",
          minLength: 16,
          description: "Opaque Callsmith report token.",
        },
      },
      ["token"],
    ),
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute({ token }) {
      const path = `/r/${encodeURIComponent(String(token))}`;
      openReport(path);
      return asToolResult({ opened: true, path });
    },
  },
  ];
}

/** Registers Callsmith's own orchestration surface with the browser agent. */
export function WebMcpBridge() {
  const router = useRouter();

  useEffect(() => {
    const registration = registerWebMcpTools(workbenchTools((path) => router.push(path)));
    return registration.unregister;
  }, [router]);

  return null;
}

export default WebMcpBridge;
