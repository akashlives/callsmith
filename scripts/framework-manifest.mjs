import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tracked = [
  "next",
  "react",
  "react-dom",
  "typescript",
  "webmcp-evals",
  "@playwright/test",
  "vitest",
  "zod",
  "ioredis",
  "eslint",
  "jsdom",
];

async function installedVersion(name) {
  const path = resolve("node_modules", ...name.split("/"), "package.json");
  return JSON.parse(await readFile(path, "utf8")).version;
}

const dockerfile = await readFile(resolve("Dockerfile"), "utf8");
const nodeImage = dockerfile.match(/^ARG NODE_VERSION=([^\s]+)$/m)?.[1] ?? "unrecorded";
const chromeImage = dockerfile.match(/^ARG CHROME_VERSION=([^\s]+)$/m)?.[1] ?? "unrecorded";
const packages = Object.fromEntries(
  await Promise.all(tracked.map(async (name) => [name, await installedVersion(name)])),
);
const applicationRevision =
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.GIT_SHA ||
  (await execFileAsync("git", ["rev-parse", "HEAD"])).stdout.trim();
const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  applicationRevision,
  productionLane: { nodeImage, chromeImage, packages },
  webMcpSpecificationRevision:
    process.env.WEBMCP_SPEC_REVISION || "resolve-in-edge-canary",
};
const canonical = JSON.stringify(payload);
process.stdout.write(
  `${JSON.stringify({
    ...payload,
    manifestRevision: createHash("sha256").update(canonical).digest("hex"),
  }, null, 2)}\n`,
);
