"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import {
  asToolResult,
  registerWebMcpTools,
  strictObjectSchema,
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

export function workbenchTools(openReport: (path: string) => void): readonly WebMcpTool[] {
  return [
  {
    name: "list_suites",
    title: "List Callsmith suites",
    description:
      "List the safe, hosted WebMCP reliability suites and scenarios available in Callsmith.",
    inputSchema: strictObjectSchema(),
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    async execute(_input, { signal }) {
      const response = await fetch("/api/suites", { signal });
      return asToolResult(await readJson(response));
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
          description: "Models to compare using an identical seed.",
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
          enum: ["preview", "model"],
          description:
            "Use preview for deterministic public evidence, or model when the deployment has a provider key.",
        },
      },
      ["suiteId", "scenarioId"],
    ),
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input, { signal }) {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...input,
          provenance: input.provenance === "model" ? "model" : "preview",
        }),
        signal,
      });
      const run = (await readJson(response)) as { id?: unknown };
      if (typeof run.id !== "string") return asToolResult({ run });

      const shareResponse = await fetch(`/api/runs/${encodeURIComponent(run.id)}/share`, {
        method: "POST",
        signal,
      });
      const report = await readJson(shareResponse);
      return asToolResult({ run, report });
    },
  },
  {
    name: "get_run_status",
    title: "Get run status",
    description:
      "Read the current status, completed attempts, scores, and failure details for a Callsmith run.",
    inputSchema: strictObjectSchema(
      {
        runId: { type: "string", description: "Callsmith run identifier." },
      },
      ["runId"],
    ),
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    async execute({ runId }, { signal }) {
      const response = await fetch(`/api/runs/${encodeURIComponent(String(runId))}`, {
        signal,
      });
      return asToolResult(await readJson(response));
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
