import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { executeInBrowserEvals } from "webmcp-evals/dist/evaluator/index.js";

import { OpenAIResponsesBrowserBackend } from "./openai-responses-browser-backend.mjs";

const execFileAsync = promisify(execFile);
const packagePath = resolve("node_modules/webmcp-evals/package.json");
const cliPath = resolve("node_modules/webmcp-evals/dist/bin/webmcp-evals.js");

export async function webMcpRunnerIdentity() {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  if (packageJson.name !== "webmcp-evals" || typeof packageJson.version !== "string") {
    throw new Error("Installed WebMCP runner has invalid package metadata.");
  }
  return { name: packageJson.name, version: packageJson.version };
}

function browserEvaluationArguments(input) {
  return [
    cliPath,
    "--backend",
    input.backend,
    "--model",
    input.model,
    "--runs",
    "1",
    "--max-steps",
    String(input.maxSteps ?? 6),
    "--reporter",
    "json",
    "--output-dir",
    input.outputDir,
    "--chrome-channel",
    input.chromeChannel ?? "chrome-dev",
    "browser",
    "--url",
    input.url,
    "--evals",
    input.evalsPath,
  ];
}

function smokeEvaluationArguments(input) {
  return [
    cliPath,
    "--chrome-channel",
    input.chromeChannel ?? "chrome-dev",
    "smoke",
    "--url",
    input.url,
    "--evals",
    input.evalsPath,
    "--timeout",
    String(input.timeoutMs ?? 30_000),
    ...(input.verbose ? ["--verbose"] : []),
  ];
}

async function execute(args, input) {
  try {
    const result = await execFileAsync(process.execPath, args, {
      cwd: input.cwd ?? process.cwd(),
      env: input.env ?? process.env,
      timeout: input.processTimeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      browserConsole: [],
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const enriched = new Error(failure.message, { cause: failure });
    enriched.stdout = typeof error?.stdout === "string" ? error.stdout : "";
    enriched.stderr = typeof error?.stderr === "string" ? error.stderr : "";
    throw enriched;
  }
}

async function latestJsonReport(outputDir) {
  const reports = (await readdir(outputDir))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const reportName = reports.at(-1);
  if (!reportName) throw new Error("webmcp-evals produced no JSON report.");
  return JSON.parse(await readFile(resolve(outputDir, reportName), "utf8"));
}

function browserConsoleEvidence(report) {
  const results = Array.isArray(report?.results)
    ? report.results
    : report?.results?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((result) =>
    Array.isArray(result.browserConsoleErrors) ? result.browserConsoleErrors : [],
  );
}

export async function runBrowserEvaluation(input) {
  if (input.backend === "openai-responses") {
    const tests = JSON.parse(await readFile(input.evalsPath, "utf8"));
    const config = {
      url: input.url,
      evalsFile: input.evalsPath,
      backend: input.backend,
      model: input.model,
      runs: 1,
      maxSteps: input.maxSteps ?? 6,
      outputDir: input.outputDir,
      reporter: ["json"],
      chromeChannel: input.chromeChannel ?? "chrome-dev",
    };
    const backend = new OpenAIResponsesBrowserBackend({
      model: input.model,
      maxSteps: input.maxSteps ?? 6,
      onStep: input.onStep,
    });
    const results = await executeInBrowserEvals(tests, backend, config);
    const report = { config, results };
    return {
      stdout: "",
      stderr: "",
      browserConsole: browserConsoleEvidence(report),
      report,
      runner: await webMcpRunnerIdentity(),
    };
  }
  const command = await execute(browserEvaluationArguments(input), {
    ...input,
    processTimeoutMs: input.processTimeoutMs ?? 150_000,
  });
  const report = await latestJsonReport(input.outputDir);
  return {
    ...command,
    report,
    browserConsole: browserConsoleEvidence(report),
    runner: await webMcpRunnerIdentity(),
  };
}

export async function runSmokeEvaluation(input) {
  const command = await execute(smokeEvaluationArguments(input), {
    ...input,
    processTimeoutMs: input.processTimeoutMs ?? 90_000,
  });
  return { ...command, runner: await webMcpRunnerIdentity() };
}
