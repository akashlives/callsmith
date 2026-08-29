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
export class OpenAIResponsesBrowserBackend {
  constructor({
    model,
    maxSteps = 6,
    apiKey = process.env.OPENAI_API_KEY,
    baseURL = process.env.OPENAI_BASE_URL,
  }) {
    if (!apiKey?.trim()) {
      throw new Error("OPENAI_API_KEY is required by the Responses browser backend.");
    }
    this.modelName = model.replace(/^openai:/, "");
    this.maxSteps = maxSteps;
    this.aiModel = createOpenAI({ apiKey, baseURL })(this.modelName);
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
      return {
        toolCalls,
        text: result.text,
        steps: buildSteps(rawSteps),
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
