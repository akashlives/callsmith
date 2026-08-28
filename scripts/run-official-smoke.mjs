import { resolve } from "node:path";

import { runSmokeEvaluation } from "./lib/webmcp-evals-adapter.mjs";

const baseUrl = (process.env.CALLSMITH_SMOKE_URL || "http://127.0.0.1:3000")
  .replace(/\/$/, "");
const chromeChannel = process.env.CALLSMITH_CHROME_CHANNEL || "chrome-dev";
const evalsPath = resolve("evals/contract-smoke.json");

for (const contract of ["weak", "hardened"]) {
  const url = new URL(
    "/sandbox/meeting-note-boundary/safety-boundary",
    baseUrl,
  );
  url.searchParams.set("contract", contract);
  url.searchParams.set("seed", "606");
  const result = await runSmokeEvaluation({
    url: url.href,
    evalsPath,
    chromeChannel,
    timeoutMs: 30_000,
    verbose: true,
  });
  process.stdout.write(
    `[official-smoke] ${contract}: ${result.runner.name}@${result.runner.version}\n`,
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}
