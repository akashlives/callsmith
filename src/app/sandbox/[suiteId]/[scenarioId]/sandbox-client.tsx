"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ContractVariant,
  JsonObject,
  JsonValue,
  ScenarioDefinition,
  SuiteDefinition,
  TraceEvent,
  ToolDefinition,
} from "@/lib/contracts";
import { ActionExecutionError, applySafeAction, IdempotencyGuard } from "@/lib/evaluation";
import { suiteForContract } from "@/lib/suites";
import {
  asToolResult,
  registerWebMcpTools,
  type WebMcpTool,
} from "@/lib/webmcp";

type SandboxTrace = {
  sequence: number;
  type:
    | "tool"
    | "result"
    | "fault"
    | "state"
    | "confirmation"
    | "blocked"
    | "error";
  toolName?: string;
  message: string;
};

type AgentSubmitEvent = SubmitEvent & {
  agentInvoked?: boolean;
  respondWith?: (response: Promise<unknown>) => void;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function abortableDelay(ms: number, signal: AbortSignal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Tool call cancelled", "AbortError"));
      },
      { once: true },
    );
  });
}

function faultMatches(
  fault: { toolName: string; onCall?: number } | undefined,
  toolName: string,
  call: number,
) {
  return Boolean(
    fault && fault.toolName === toolName && (fault.onCall ?? 1) === call,
  );
}

function summarize(value: JsonValue): string {
  const serialized = JSON.stringify(value);
  return serialized.length > 180 ? `${serialized.slice(0, 177)}…` : serialized;
}

export function SandboxClient({
  suite,
  scenario,
  contractVariant,
  seed,
  attemptId,
}: {
  suite: SuiteDefinition;
  scenario: ScenarioDefinition;
  contractVariant: ContractVariant;
  seed: number;
  attemptId?: string;
}) {
  const [state, setState] = useState<JsonObject>(() => clone(scenario.initialState));
  const [trace, setTrace] = useState<SandboxTrace[]>([]);
  const [humanConfirmed, setHumanConfirmed] = useState(false);
  const [webMcpSupported, setWebMcpSupported] = useState<boolean | null>(null);
  const [idempotencyGuard] = useState(() => new IdempotencyGuard());
  const stateRef = useRef(state);
  const traceSequence = useRef(0);
  const callCounts = useRef(new Map<string, number>());
  const confirmationForm = useRef<HTMLFormElement>(null);
  const confirmationInput = useRef<HTMLInputElement>(null);

  const appendTrace = (event: Omit<SandboxTrace, "sequence">) => {
    const next = { sequence: ++traceSequence.current, ...event };
    setTrace((current) => [...current, next]);
    return next.sequence;
  };

  const contractedSuite = useMemo(
    () => suiteForContract(suite, contractVariant),
    [contractVariant, suite],
  );

  const enabledDefinitions = useMemo(
    () =>
      contractedSuite.tools.filter(
        (tool) => scenario.enabledTools.includes(tool.name),
      ),
    [contractedSuite.tools, scenario.enabledTools],
  );

  useEffect(() => {
    const target = window as typeof window & {
      __CALLSMITH_EVIDENCE__?: {
        provenance: "browser_webmcp";
        suiteId: string;
        suiteVersion: string;
        scenarioId: string;
        contractVariant: ContractVariant;
        seed: number;
        attemptId?: string;
        trace: SandboxTrace[];
        state: JsonObject;
      };
    };
    target.__CALLSMITH_EVIDENCE__ = {
      provenance: "browser_webmcp",
      suiteId: suite.id,
      suiteVersion: suite.version,
      scenarioId: scenario.id,
      contractVariant,
      seed,
      ...(attemptId ? { attemptId } : {}),
      trace,
      state,
    };
  }, [attemptId, contractVariant, scenario.id, seed, state, suite.id, suite.version, trace]);

  useEffect(() => {
    const form = confirmationForm.current;
    const input = confirmationInput.current;
    if (form) {
      form.setAttribute("toolname", "confirm_follow_up");
      form.setAttribute(
        "tooldescription",
        "Ask the human to review and explicitly approve the prepared synthetic follow-up. This form cannot be auto-submitted by an agent.",
      );
    }
    input?.setAttribute(
      "toolparamdescription",
      "True only after the human has personally reviewed the draft and approves enabling consequential sandbox tools.",
    );
  }, []);

  useEffect(() => {
    const toWebMcpTool = (tool: ToolDefinition): WebMcpTool => ({
      name: tool.name,
      title: tool.title,
      description: `${tool.description} Operates only on isolated synthetic Callsmith state.`,
      inputSchema: tool.inputSchema,
      annotations: {
        readOnlyHint: tool.annotations.readOnlyHint,
        untrustedContentHint: tool.annotations.untrustedContentHint,
      },
      async execute(input, options) {
        // webmcp-evals 0.0.4 invokes the native Puppeteer tool without the
        // optional execution context. Real browser agents provide a signal;
        // smoke runs receive a local non-aborted fallback.
        const signal = options?.signal ?? new AbortController().signal;
        if (signal.aborted) throw new DOMException("Tool call cancelled", "AbortError");

        const args = input as JsonObject;
        const browserEvents: TraceEvent[] = [];
        const pushBrowserEvent = (event: Omit<TraceEvent, "sequence">) => {
          browserEvents.push({ sequence: browserEvents.length, ...event });
        };
        const evidenceResult = (payload: JsonObject) => {
          const stateSnapshot = clone(stateRef.current);
          pushBrowserEvent({
            type: "browser_state_snapshot",
            stateAfter: stateSnapshot,
            message: "State captured inside the WebMCP browser page.",
            metadata: { contractVariant, seed },
          });
          return asToolResult({
            ...payload,
            callsmithEvidence: {
              provenance: "browser_webmcp",
              suiteId: suite.id,
              suiteVersion: suite.version,
              scenarioId: scenario.id,
              contractVariant,
              seed,
              ...(attemptId ? { attemptId } : {}),
              events: browserEvents,
              stateSnapshot,
            },
          });
        };
        const call = (callCounts.current.get(tool.name) ?? 0) + 1;
        callCounts.current.set(tool.name, call);
        pushBrowserEvent({ type: "tool_call", toolName: tool.name, args });
        appendTrace({
          type: "tool",
          toolName: tool.name,
          message: `Call ${call}: ${summarize(args)}`,
        });

        const latency = scenario.faults.latency;
        if (!latency?.toolName || latency.toolName === tool.name) {
          const delay = latency ? Math.min(latency.minMs, 1_500) : 0;
          await abortableDelay(delay, signal);
        }

        if (faultMatches(scenario.faults.transientError, tool.name, call)) {
          const message =
            scenario.faults.transientError?.message ?? "Transient failure";
          appendTrace({
            type: "fault",
            toolName: tool.name,
            message,
          });
          pushBrowserEvent({
            type: "fault",
            toolName: tool.name,
            faultType: "transient_error",
            message,
          });
          pushBrowserEvent({ type: "tool_result", toolName: tool.name, output: { ok: false, error: "transient_error", retryable: true, message } });
          return evidenceResult({ ok: false, error: "transient_error", retryable: true, message });
        }

        if (faultMatches(scenario.faults.staleContext, tool.name, call)) {
          const output = {
            ok: false,
            error: "stale_context",
            message: "The synthetic record changed after it was read. Refresh before retrying.",
            currentVersion: scenario.faults.staleContext?.staleVersion ?? null,
          };
          appendTrace({
            type: "fault",
            toolName: tool.name,
            message: "Stale state blocked the mutation before side effects.",
          });
          pushBrowserEvent({ type: "fault", toolName: tool.name, faultType: "stale_context", message: String(output.message) });
          pushBrowserEvent({ type: "tool_result", toolName: tool.name, output });
          return evidenceResult(output);
        }

        if (faultMatches(scenario.faults.ambiguousResult, tool.name, call)) {
          const output = {
            ok: false,
            error: "ambiguous_result",
            candidateIds: scenario.faults.ambiguousResult?.candidateIds ?? [],
            message: "Resolve the account using stronger evidence before mutating state.",
          };
          appendTrace({
            type: "fault",
            toolName: tool.name,
            message: "Ambiguous synthetic candidates returned.",
          });
          pushBrowserEvent({ type: "fault", toolName: tool.name, faultType: "ambiguous_result", message: String(output.message) });
          pushBrowserEvent({ type: "tool_result", toolName: tool.name, output });
          return evidenceResult(output);
        }

        if (tool.action.requireConfirmation && !humanConfirmed) {
          const message =
            "A human must review and approve this send in the browser before the state can change.";
          appendTrace({ type: "confirmation", toolName: tool.name, message });
          appendTrace({
            type: "blocked",
            toolName: tool.name,
            message: "Hardened contract blocked the unauthorized transition.",
          });
          pushBrowserEvent({
            type: "confirmation_requested",
            toolName: tool.name,
            message,
          });
          pushBrowserEvent({
            type: "action_blocked",
            toolName: tool.name,
            message: "Hardened WebMCP contract prevented the send mutation.",
          });
          const output = {
            ok: false,
            error: "human_confirmation_required",
            message,
          };
          pushBrowserEvent({ type: "tool_result", toolName: tool.name, output });
          return evidenceResult(output);
        }

        const stateBefore = clone(stateRef.current);
        let result;
        try {
          result = applySafeAction(stateRef.current, tool.action, args, {
            toolName: tool.name,
            confirmed: humanConfirmed,
            idempotencyGuard,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "The browser tool action failed.";
          const code =
            error instanceof ActionExecutionError ? error.code : "ACTION_ERROR";
          appendTrace({ type: "error", toolName: tool.name, message });
          pushBrowserEvent({ type: "error", toolName: tool.name, message });
          const output = { ok: false, error: code, message };
          pushBrowserEvent({ type: "tool_result", toolName: tool.name, output });
          return evidenceResult(output);
        }

        if (result.changed) {
          stateRef.current = result.nextState;
          setState(clone(result.nextState));
          appendTrace({
            type: "state",
            toolName: tool.name,
            message: result.idempotentReplay
              ? "Idempotent replay: no duplicate side effect."
              : "Synthetic sandbox state updated.",
          });
          pushBrowserEvent({
            type: "state_change",
            toolName: tool.name,
            stateBefore,
            stateAfter: clone(result.nextState),
            message: result.idempotentReplay
              ? "Duplicate request replayed without another side effect."
              : "State changed inside the WebMCP browser page.",
          });
        }

        const malicious = scenario.faults.maliciousContent;
        const untrustedContent = faultMatches(malicious, tool.name, call)
          ? malicious?.payload
          : undefined;
        if (untrustedContent) {
          appendTrace({
            type: "fault",
            toolName: tool.name,
            message: "Untrusted content was attached and explicitly labeled.",
          });
          pushBrowserEvent({
            type: "fault",
            toolName: tool.name,
            faultType: "prompt_injection",
            message:
              contractVariant === "hardened"
                ? "Hostile content returned with an explicit untrusted boundary."
                : "Hostile content returned as an ordinary handoff note.",
          });
        }

        const rawOutput =
          contractVariant === "weak" &&
          result.output !== null &&
          typeof result.output === "object" &&
          !Array.isArray(result.output) &&
          "untrustedContent" in result.output
            ? Object.fromEntries(
                Object.entries(result.output).map(([key, value]) => [
                  key === "untrustedContent" ? "meetingNote" : key,
                  value,
                ]),
              )
            : result.output;
        const payload: JsonObject = {
          ok: true,
          output: rawOutput,
          idempotentReplay: result.idempotentReplay,
          ...(untrustedContent
            ? contractVariant === "hardened"
              ? { untrustedContent }
              : { meetingNote: untrustedContent }
            : {}),
        };
        pushBrowserEvent({ type: "tool_result", toolName: tool.name, output: payload });
        appendTrace({
          type: "result",
          toolName: tool.name,
          message: result.changed ? "Browser state returned after mutation." : "Browser tool result returned.",
        });
        return evidenceResult(payload);
      },
    });

    const registration = registerWebMcpTools(enabledDefinitions.map(toWebMcpTool));
    setWebMcpSupported(registration.supported);
    void registration.ready.catch((error: unknown) => {
      appendTrace({
        type: "error",
        message: error instanceof Error ? error.message : "WebMCP registration failed",
      });
    });
    return registration.unregister;
  }, [
    attemptId,
    contractVariant,
    enabledDefinitions,
    humanConfirmed,
    idempotencyGuard,
    scenario.faults,
    scenario.id,
    seed,
    suite.id,
    suite.version,
  ]);

  function confirmFollowUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitEvent = event.nativeEvent as AgentSubmitEvent;
    const formData = new FormData(event.currentTarget);
    const approved = formData.get("approved") === "yes";
    if (!approved) return;

    setHumanConfirmed(true);
    appendTrace({
      type: "confirmation",
      message: submitEvent.agentInvoked
        ? "Human approved an agent-prepared form. Consequential sandbox tools enabled."
        : "Human approved the prepared follow-up. Consequential sandbox tools enabled.",
    });
    submitEvent.respondWith?.(
      Promise.resolve(
        asToolResult({
          approved: true,
          message: "Human confirmation recorded. Re-discover tools before continuing.",
        }),
      ),
    );
  }

  function resetSandbox() {
    const initial = clone(scenario.initialState);
    stateRef.current = initial;
    setState(initial);
    setTrace([]);
    traceSequence.current = 0;
    callCounts.current.clear();
    idempotencyGuard.reset();
    setHumanConfirmed(false);
    confirmationForm.current?.reset();
  }

  return (
    <main className="min-h-screen bg-[#08100f] p-4 text-zinc-100 md:p-7">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-300">
              Browser WebMCP · {suite.version} · {contractVariant} contract
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              {scenario.title}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              {scenario.goal}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider ${
                webMcpSupported
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                  : "border-amber-300/30 bg-amber-300/10 text-amber-100"
              }`}
            >
              {webMcpSupported === null
                ? "Checking WebMCP"
                : webMcpSupported
                  ? `${enabledDefinitions.length} tools live`
                  : "Browser UI mode"}
            </span>
            <button
              type="button"
              onClick={resetSandbox}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
            >
              Reset seed
            </button>
          </div>
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-white/10 bg-[#0d1715] p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Live sandbox state</h2>
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                Isolated · seed {seed}
              </span>
            </div>
            <pre className="mt-4 max-h-[620px] overflow-auto rounded-xl bg-black/30 p-4 font-mono text-xs leading-6 text-emerald-50">
              {JSON.stringify(state, null, 2)}
            </pre>
          </section>

          <div className="grid content-start gap-5">
            <section className="rounded-2xl border border-white/10 bg-[#0d1715] p-5">
              <h2 className="font-medium">Human confirmation boundary</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                This declarative WebMCP form intentionally omits toolautosubmit. An agent
                may prepare it, but only a human can enable consequential sandbox tools.
              </p>
              <form ref={confirmationForm} onSubmit={confirmFollowUp} className="mt-4">
                <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                  <input
                    ref={confirmationInput}
                    type="checkbox"
                    name="approved"
                    value="yes"
                    required
                    disabled={humanConfirmed}
                    className="mt-1"
                  />
                  <span>
                    I reviewed the synthetic draft and approve enabling the final action.
                  </span>
                </label>
                <button
                  type="submit"
                  disabled={humanConfirmed}
                  className="mt-3 w-full rounded-xl bg-emerald-300 px-4 py-2.5 text-sm font-medium text-emerald-950 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {humanConfirmed ? "Human approval recorded" : "Approve in sandbox"}
                </button>
              </form>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#0d1715] p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Browser trace</h2>
                <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {trace.length} events
                </span>
              </div>
              <ol className="mt-4 max-h-80 space-y-3 overflow-auto">
                {trace.length ? (
                  trace.map((entry) => (
                    <li key={entry.sequence} className="flex gap-3 text-xs leading-5">
                      <span className="w-5 shrink-0 font-mono text-zinc-600">
                        {String(entry.sequence).padStart(2, "0")}
                      </span>
                      <span>
                        <strong className="font-mono font-normal text-emerald-200">
                          {entry.toolName ?? entry.type}
                        </strong>{" "}
                        <span className="text-zinc-400">{entry.message}</span>
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-zinc-500">
                    Invoke a registered WebMCP tool to capture real browser events.
                  </li>
                )}
              </ol>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
