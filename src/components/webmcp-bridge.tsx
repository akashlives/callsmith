"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ContractReviewPanel,
  type ContractProposalResponse,
} from "@/components/contract-review-panel";
import { CANONICAL_SAFETY_CONTRACT } from "@/lib/canonical-contract";
import {
  asToolResult,
  registerWebMcpTools,
  strictObjectSchema,
  type WebMcpExecuteOptions,
  type WebMcpTool,
} from "@/lib/webmcp";

type JsonRecord = Record<string, unknown>;

export type WorkbenchToolRuntime = {
  onProposalCreated?: (proposal: ContractProposalResponse) => void;
  proposalExperiments?: Map<string, JsonRecord>;
};

async function readJson(response: Response): Promise<JsonRecord> {
  const data = (await response.json()) as unknown;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as JsonRecord).error)
        : `Callsmith request failed (${response.status})`;
    throw new Error(message);
  }
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as JsonRecord)
    : { value: data };
}

function executionSignal(options?: WebMcpExecuteOptions): AbortSignal {
  return options?.signal ?? new AbortController().signal;
}

function compactToolResult(data: JsonRecord) {
  const serialized = JSON.stringify(data);
  if (new TextEncoder().encode(serialized).byteLength > 1_500) {
    return asToolResult({
      ok: false,
      code: "tool_output_budget_exceeded",
      message: "Callsmith refused to return an oversized tool payload.",
    });
  }
  return asToolResult(data);
}

function failedToolResult(error: unknown) {
  return compactToolResult({
    ok: false,
    code: "callsmith_request_failed",
    message: error instanceof Error ? error.message : String(error),
  });
}

const safetyContractInputSchema = strictObjectSchema(
  {
    schemaVersion: { type: "integer", enum: [1] },
    id: { type: "string", maxLength: 30, description: "Lowercase contract slug." },
    title: { type: "string", description: "Human-readable safety case title." },
    domain: { type: "string", description: "Synthetic workflow domain." },
    goal: { type: "string", description: "Neutral task for the browser agent." },
    seed: { type: "integer", description: "Deterministic experiment seed." },
    record: {
      type: "object",
      properties: {
        collection: { type: "string" },
        id: { type: "string" },
        fields: { type: "object" },
        untrustedField: { type: "string" },
        hostileContent: { type: "string" },
      },
      required: ["collection", "id", "fields", "untrustedField", "hostileContent"],
      additionalProperties: false,
    },
    tools: {
      type: "object",
      properties: {
        read: {
          type: "object",
          properties: { name: { type: "string" }, title: { type: "string" } },
          required: ["name", "title"],
          additionalProperties: false,
        },
        protectedMutation: {
          type: "object",
          properties: {
            name: { type: "string" },
            title: { type: "string" },
            field: { type: "string" },
            unsafeValue: {},
          },
          required: ["name", "title", "field", "unsafeValue"],
          additionalProperties: false,
        },
      },
      required: ["read", "protectedMutation"],
      additionalProperties: false,
    },
  },
  ["schemaVersion", "id", "title", "domain", "goal", "seed", "record", "tools"],
);

export function workbenchTools(
  openReceipt: (path: string) => void,
  runtime: WorkbenchToolRuntime = {},
): readonly WebMcpTool[] {
  return [
    {
      name: "get_contract_template",
      title: "Get safety contract template",
      description:
        "Return Callsmith's compact JSON-only safety contract template and limits. Use synthetic data; never include credentials or URLs.",
      inputSchema: strictObjectSchema(),
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() {
        return compactToolResult({
          ok: true,
          template: CANONICAL_SAFETY_CONTRACT,
          limits: { bytes: 8192, scalarFields: 12, toolNameCharacters: 30 },
        });
      },
    },
    {
      name: "propose_safety_contract",
      title: "Propose safety contract",
      description:
        "Validate a synthetic safety contract and open an on-page human review. Returns immediately; approval cannot be supplied as a tool argument.",
      inputSchema: safetyContractInputSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input, options) {
        try {
          const response = await fetch("/api/contracts/proposals", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
            signal: executionSignal(options),
          });
          const body = await readJson(response);
          runtime.onProposalCreated?.(body as ContractProposalResponse);
          const operation = body.operation as JsonRecord;
          return compactToolResult({
            ok: true,
            operationId: operation.operationId,
            status: operation.status,
            statusCapability: body.statusCapability,
            expiresAt: operation.expiresAt,
            message: "Human review opened. Poll status; do not attempt to approve through a tool.",
          });
        } catch (error) {
          return failedToolResult(error);
        }
      },
    },
    {
      name: "get_callsmith_status",
      title: "Get Callsmith operation status",
      description:
        "Read compact status for a proposal or experiment using its opaque read capability. It never returns raw traces or private decision credentials.",
      inputSchema: strictObjectSchema(
        {
          kind: { type: "string", enum: ["proposal", "experiment"], description: "Operation kind." },
          operation_id: { type: "string", description: "Callsmith operation identifier." },
          capability: { type: "string", description: "Opaque read-only capability." },
        },
        ["kind", "operation_id", "capability"],
      ),
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async execute(input, options) {
        try {
          const kind = String(input.kind);
          const operationId = String(input.operation_id);
          const capability = String(input.capability);
          const path = kind === "proposal"
            ? `/api/contracts/proposals/${encodeURIComponent(operationId)}/status`
            : `/api/experiments/${encodeURIComponent(operationId)}`;
          const response = await fetch(path, {
            headers: { authorization: `Bearer ${capability}` },
            signal: executionSignal(options),
            cache: "no-store",
          });
          const status = await readJson(response);
          const attached = runtime.proposalExperiments?.get(operationId);
          return compactToolResult({
            ok: true,
            status,
            ...(attached ? { approvedExperiment: attached } : {}),
          });
        } catch (error) {
          return failedToolResult(error);
        }
      },
    },
    {
      name: "run_decisive_case",
      title: "Run decisive safety case",
      description:
        "Start Callsmith's fixed browser-native meeting-note proof using Luna, seed 606, and matched weak/hardened website contracts.",
      inputSchema: strictObjectSchema(),
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(_input, options) {
        try {
          const response = await fetch("/api/experiments", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
            signal: executionSignal(options),
          });
          const body = await readJson(response);
          const experiment = body.experiment as JsonRecord;
          const links = body.links as JsonRecord;
          return compactToolResult({
            ok: true,
            experimentId: experiment.id,
            status: experiment.status,
            statusCapability: body.accessToken,
            receiptToken: body.receiptToken,
            receiptPath: links.receipt,
          });
        } catch (error) {
          return failedToolResult(error);
        }
      },
    },
    {
      name: "open_evidence_receipt",
      title: "Open evidence receipt",
      description:
        "Open an immutable Callsmith evidence receipt by its opaque token. This is navigation only and cannot mutate experiment data.",
      inputSchema: strictObjectSchema(
        { token: { type: "string", description: "Opaque evidence receipt token." } },
        ["token"],
      ),
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute({ token }) {
        const path = `/r/${encodeURIComponent(String(token))}`;
        openReceipt(path);
        return compactToolResult({ ok: true, opened: true, path });
      },
    },
  ];
}

function WebMcpBridge() {
  const router = useRouter();
  const [proposal, setProposal] = useState<ContractProposalResponse>();
  const [proposalExperiments] = useState(() => new Map<string, JsonRecord>());
  const runtime = useMemo<WorkbenchToolRuntime>(
    () => ({ onProposalCreated: setProposal, proposalExperiments }),
    [proposalExperiments],
  );

  useEffect(() => {
    const registration = registerWebMcpTools(
      workbenchTools((path) => router.push(path), runtime),
    );
    return registration.unregister;
  }, [router, runtime]);

  return proposal ? (
    <ContractReviewPanel
      key={proposal.operation.operationId}
      proposal={proposal}
      onClose={() => setProposal(undefined)}
      onDecided={(result) => {
        const body = result && typeof result === "object"
          ? result as JsonRecord
          : undefined;
        const experiment = body?.experiment as JsonRecord | undefined;
        const capabilities = body?.privateCapabilities as JsonRecord | undefined;
        const links = body?.links as JsonRecord | undefined;
        if (experiment && capabilities && links) {
          proposalExperiments.set(proposal.operation.operationId, {
            experimentId: experiment.id,
            status: experiment.status,
            statusCapability: capabilities.accessToken,
            receiptToken: capabilities.receiptToken,
            receiptPath: links.receipt,
          });
        }
      }}
    />
  ) : null;
}

export default WebMcpBridge;
