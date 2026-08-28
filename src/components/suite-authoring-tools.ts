import {
  CALLSMITH_AUTHORING_GUIDE,
  GUIDED_SUITE_TOOL_INPUT_SCHEMA,
} from "@/lib/suite-authoring-guide";
import { GuidedSuiteDraftSchema } from "@/lib/contracts";
import {
  asToolResult,
  strictObjectSchema,
  type WebMcpTool,
} from "@/lib/webmcp";
import type { ConfirmationTerminalResult } from "@/lib/confirmation-coordinator";

export type RequestHumanReview = (
  draft: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<ConfirmationTerminalResult>;

/**
 * Tool construction stays pure so the schema and trust boundary are easy to
 * verify without a browser. The approval capability never appears here: only
 * the on-page human review coordinator can exercise it.
 */
export function suiteAuthoringTools(
  requestHumanReview: RequestHumanReview,
): readonly WebMcpTool[] {
  return [
    {
      name: "get_authoring_guide",
      title: "Read the Callsmith authoring guide",
      description:
        "Read the safe JSON contract for authoring a synthetic WebMCP gauntlet. This does not create, publish, or run anything.",
      inputSchema: strictObjectSchema(),
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() {
        return asToolResult(CALLSMITH_AUTHORING_GUIDE);
      },
    },
    {
      name: "draft_and_run_suite",
      title: "Draft a suite for human review",
      description:
        "Validate a synthetic JSON gauntlet and open Callsmith's exact on-page review. Pass the complete draft as JSON text in draftJson after reading get_authoring_guide. This call waits for the human. Only their on-page approval can publish the immutable unlisted suite, start its weak/hardened comparison, and return the run plus read-only report path; rejection, cancellation, expiry, or navigation starts no run.",
      inputSchema: GUIDED_SUITE_TOOL_INPUT_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input, options) {
        // Chrome's WebMCP Inspector currently invokes page tools without the
        // optional execution context. Preserve cancellation when the browser
        // supplies it, while remaining callable by that real judge surface.
        const signal = options?.signal ?? new AbortController().signal;
        // Raw objects remain readable for pre-M5 browser clients, but the
        // portable WebMCP declaration exposes only the compact JSON transport.
        let draft: unknown = input;
        if ("draftJson" in input && typeof input.draftJson !== "string") {
          return asToolResult({
            ok: false,
            status: "invalid_request",
            code: "invalid_draft_json",
            message: "draftJson must be a JSON string.",
          });
        }
        if (typeof input.draftJson === "string") {
          try {
            draft = JSON.parse(input.draftJson) as unknown;
            if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
              throw new Error("The decoded draft must be an object.");
            }
          } catch (error) {
            return asToolResult({
              ok: false,
              status: "invalid_request",
              code: "invalid_draft_json",
              message:
                error instanceof Error
                  ? `draftJson could not be parsed: ${error.message}`
                  : "draftJson could not be parsed.",
            });
          }
        }

        const parsed = GuidedSuiteDraftSchema.safeParse(draft);
        if (!parsed.success) {
          return asToolResult({
            ok: false,
            status: "invalid_request",
            code: "invalid_draft",
            message:
              "The draft is invalid. Fix the listed fields and call draft_and_run_suite again.",
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          });
        }
        return asToolResult(await requestHumanReview(parsed.data, signal));
      },
    },
  ];
}
