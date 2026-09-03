import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, ToolLoopAgent } from "ai";
import {
  mapJsonSchemaToVercelTools,
  mapMessages,
} from "webmcp-evals/dist/evaluator/mappers.js";
import { SYSTEM_PROMPT } from "webmcp-evals/dist/evaluator/prompts.js";

/**
 * Keep webmcp-evals' native browser registry and trajectory matcher while using
 * OpenAI's Responses API. webmcp-evals@0.0.4 forces Chat Completions, which
 * rejects Luna function tools unless reasoning is disabled.
 */
async function captureStepFrame(page) {
  if (typeof page?.screenshot !== "function") return undefined;
  try {
    if (typeof page.setViewport === "function") {
      await page.setViewport({ width: 1280, height: 800 });
    }
    const clipTarget =
      typeof page.$ === "function" ? await page.$("[data-record-app]") : null;
    const source = clipTarget ?? page;
    const frame = await source.screenshot({
      type: "jpeg",
      quality: 45,
      encoding: "base64",
    });
    return typeof frame === "string" && frame.length > 0 ? frame : undefined;
  } catch {
    return undefined;
  }
}

function summarizeToolCalls(step) {
  return (step?.toolCalls ?? []).map((call) => ({
    name: call.toolName,
    args: call.input ?? call.args ?? call.arguments ?? {},
  }));
}

function summarizeToolResults(step) {
  return (step?.toolResults ?? []).map((result) => {
    const output = result.result ?? result.output;
    const failed =
      output && typeof output === "object" && !Array.isArray(output) && output.ok === false;
    const summary =
      failed && typeof output.error === "string"
        ? output.error
        : failed && typeof output.message === "string"
          ? output.message
          : failed
            ? "blocked"
            : "ok";
    return {
      name: result.toolName,
      ok: !failed,
      summary,
    };
  });
}

export class OpenAIResponsesBrowserBackend {
  constructor({
    model,
    maxSteps = 6,
    apiKey = process.env.OPENAI_API_KEY,
    baseURL = process.env.OPENAI_BASE_URL,
    onStep,
  }) {
    if (!apiKey?.trim()) {
      throw new Error("OPENAI_API_KEY is required by the Responses browser backend.");
    }
    this.modelName = model.replace(/^openai:/, "");
    this.maxSteps = maxSteps;
    this.aiModel = createOpenAI({ apiKey, baseURL })(this.modelName);
    this.onStep = typeof onStep === "function" ? onStep : undefined;
  }

  describe() {
    return `OpenAI Responses browser backend using model: ${this.modelName}`;
  }

  async executeInBrowserEval(test, registry) {
    const availableToolsPerStep = [];
    const stepsHistory = [];
    const browserConsoleErrors = () =>
      typeof registry.getBrowserConsoleErrors === "function"
        ? registry.getBrowserConsoleErrors()
        : [];
    const browserEvidence = async () => {
      if (typeof registry.page?.evaluate !== "function") return undefined;
      return registry.page.evaluate(
        () => globalThis.__CALLSMITH_EVIDENCE__ ?? undefined,
      );
    };
    const buildSteps = (steps) =>
      (steps?.length ? steps : stepsHistory).map((step, index) => ({
        text: step.text,
        reasoningText: step.reasoningText,
        toolCalls: step.toolCalls,
        toolResults: step.toolResults,
        availableTools: availableToolsPerStep[index] ?? [],
      }));

    try {
      let currentTools = await registry.getCurrentTools();
      const executableTools = {};
      const rebuildTools = (toolDefinitions) => {
        for (const name of Object.keys(executableTools)) delete executableTools[name];
        Object.assign(
          executableTools,
          mapJsonSchemaToVercelTools(toolDefinitions, (name, args) =>
            registry.executeTool(name, args),
          ),
        );
      };
      rebuildTools(currentTools);

      const emitStep = async (stepIndex, step) => {
        if (!this.onStep) return;
        try {
          await this.onStep({
            stepIndex,
            toolCalls: summarizeToolCalls(step),
            toolResults: summarizeToolResults(step),
            text: typeof step?.text === "string" ? step.text : "",
            screenshot: await captureStepFrame(registry.page),
          });
        } catch {
          // A missing frame or a down web process must never fail the pair.
        }
      };

      await emitStep(0, { toolCalls: [], toolResults: [], text: "" });

      const agent = new ToolLoopAgent({
        model: this.aiModel,
        tools: executableTools,
        instructions: SYSTEM_PROMPT,
        stopWhen: stepCountIs(this.maxSteps),
        onStepFinish: (step) => {
          stepsHistory.push({
            text: step.text,
            reasoningText: step.reasoningText,
            toolCalls: step.toolCalls,
            toolResults: step.toolResults,
          });
          void emitStep(stepsHistory.length, step);
        },
        prepareStep: async (options) => {
          currentTools = await registry.getCurrentTools();
          rebuildTools(currentTools);
          availableToolsPerStep.push([...currentTools]);
          return options;
        },
      });
      const result = await agent.generate({ messages: mapMessages(test.messages) });
      const rawSteps = result.steps?.length ? result.steps : stepsHistory;
      const toolCalls = [];
      for (const step of rawSteps) {
        for (const call of step.toolCalls ?? []) {
          const matchingResult = (step.toolResults ?? []).find((candidate) =>
            call.toolCallId
              ? candidate.toolCallId === call.toolCallId
              : candidate.toolName === call.toolName,
          );
          toolCalls.push({
            functionName: call.toolName,
            args: call.input ?? call.args ?? call.arguments ?? {},
            result: matchingResult
              ? (matchingResult.result ?? matchingResult.output)
              : undefined,
          });
        }
      }
      const steps = buildSteps(rawSteps);
      const evidence = await browserEvidence();
      if (evidence && steps.length > 0) {
        steps[steps.length - 1] = {
          ...steps[steps.length - 1],
          callsmithEvidence: evidence,
        };
      } else if (evidence) {
        steps.push({
          text: "",
          reasoningText: "",
          toolCalls: [],
          toolResults: [],
          availableTools: [],
          callsmithEvidence: evidence,
        });
      }
      return {
        toolCalls,
        text: result.text,
        steps,
        browserConsoleErrors: browserConsoleErrors(),
      };
    } catch (error) {
      return {
        toolCalls: [],
        steps: buildSteps(),
        browserConsoleErrors: browserConsoleErrors(),
        error,
      };
    }
  }
}
