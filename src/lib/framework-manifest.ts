import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type PackageJson = {
  version?: string;
};

const TRACKED_PACKAGES = [
  "next",
  "react",
  "react-dom",
  "typescript",
  "webmcp-evals",
  "@playwright/test",
  "vitest",
  "zod",
  "ioredis",
] as const;

export type FrameworkManifestV1 = {
  schemaVersion: 1;
  node: string;
  applicationRevision: string;
  packages: Record<string, string>;
  revision: string;
};

let cached: Promise<FrameworkManifestV1> | undefined;

export async function frameworkManifest(): Promise<FrameworkManifestV1> {
  cached ??= (async () => {
    const packages = Object.fromEntries(
      await Promise.all(
        TRACKED_PACKAGES.map(async (name) => {
          const installed = JSON.parse(
            await readFile(
              resolve("node_modules", ...name.split("/"), "package.json"),
              "utf8",
            ),
          ) as PackageJson;
          if (!installed.version) {
            throw new Error(`Installed framework ${name} has no version`);
          }
          return [name, installed.version] as const;
        }),
      ),
    );
    const applicationRevision =
      process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
      process.env.GIT_SHA?.trim() ||
      "development";
    const payload = JSON.stringify({
      node: process.version,
      applicationRevision,
      packages,
    });
    return {
      schemaVersion: 1,
      node: process.version,
      applicationRevision,
      packages,
      revision: createHash("sha256").update(payload).digest("hex"),
    };
  })();
  return cached;
}
