import type { JsonObject, SuiteDefinitionV2 } from "@/lib/contracts";
import {
  SuiteCompilerError,
  compileGuidedSuiteDraft,
  migrateSuiteDefinition,
  type SuiteCompilerIssue,
} from "@/lib/suite-compiler";

export type SuiteAuthoringIssue = SuiteCompilerIssue & {
  path: Array<string | number>;
};

export class SuiteAuthoringError extends Error {
  constructor(public readonly issues: SuiteAuthoringIssue[]) {
    super(issues.map((issue) => issue.message).join("\n"));
    this.name = "SuiteAuthoringError";
  }
}

function objectInput(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function prefixIssues(
  prefix: string,
  error: SuiteCompilerError,
): SuiteAuthoringIssue[] {
  return error.issues.map((issue) => ({
    ...issue,
    path: [prefix, ...issue.path],
  }));
}

export function compileDraftEnvelope(input: unknown): {
  source: "guided" | "legacy";
  candidate: SuiteDefinitionV2;
  storedDraft: JsonObject;
} {
  const body = objectInput(input);
  const hasDraft = body && Object.hasOwn(body, "draft");
  const hasSuite = body && Object.hasOwn(body, "suite");
  if (!body || hasDraft === hasSuite) {
    throw new SuiteAuthoringError([
      {
        code: "invalid_draft",
        path: [],
        message: "Provide exactly one of draft or suite",
      },
    ]);
  }

  if (hasDraft) {
    try {
      const candidate = compileGuidedSuiteDraft(body.draft);
      return {
        source: "guided",
        candidate,
        storedDraft: structuredClone(body.draft) as JsonObject,
      };
    } catch (error) {
      if (error instanceof SuiteCompilerError) {
        throw new SuiteAuthoringError(prefixIssues("draft", error));
      }
      throw error;
    }
  }

  try {
    const candidate = migrateSuiteDefinition(body.suite);
    return {
      source: "legacy",
      candidate,
      storedDraft: {
        kind: "suite_definition",
        suiteId: candidate.id,
        suiteVersion: candidate.version,
        title: candidate.title,
      },
    };
  } catch (error) {
    if (error instanceof SuiteCompilerError) {
      throw new SuiteAuthoringError(prefixIssues("suite", error));
    }
    throw error;
  }
}

export function validateSuiteAuthoringInput(input: unknown): {
  source: "guided" | "legacy";
  suite: SuiteDefinitionV2;
} {
  const body = objectInput(input);
  if (body && Object.hasOwn(body, "draft")) {
    try {
      return { source: "guided", suite: compileGuidedSuiteDraft(body.draft) };
    } catch (error) {
      if (error instanceof SuiteCompilerError) {
        throw new SuiteAuthoringError(prefixIssues("draft", error));
      }
      throw error;
    }
  }

  try {
    return { source: "legacy", suite: migrateSuiteDefinition(input) };
  } catch (error) {
    if (error instanceof SuiteCompilerError) {
      throw new SuiteAuthoringError(error.issues);
    }
    throw error;
  }
}
