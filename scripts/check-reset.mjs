import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(".");
const sourceRoots = ["src", "scripts", "tests"];
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json"]);
const forbidden = [
  ["deterministic preview provenance", /deterministic_preview/i],
  ["server simulation provenance", /server_simulation/i],
  ["retired run API", /\/api\/runs(?:\/|\b)/],
  ["retired suite-draft API", /\/api\/suite-drafts(?:\/|\b)/],
  ["retired suite catalog API", /\/api\/suites(?:\/|\b)/],
  ["retired model comparison", /gpt-5\.6-terra/i],
  ["retired credential mode", /\bbyok\b/i],
  ["retired suite migration", /SuiteDefinitionV1|migrateSuiteDefinition/],
];

async function filesUnder(path) {
  const entries = await readdir(path);
  const files = [];
  for (const entry of entries) {
    const absolute = join(path, entry);
    const metadata = await stat(absolute);
    if (metadata.isDirectory()) files.push(...await filesUnder(absolute));
    else if (textExtensions.has(extname(entry))) files.push(absolute);
  }
  return files;
}

const files = (
  await Promise.all(sourceRoots.map((directory) => filesUnder(resolve(directory))))
).flat();
const violations = [];
for (const file of files) {
  if (file.endsWith("scripts/check-reset.mjs")) continue;
  const source = await readFile(file, "utf8");
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) violations.push(`${relative(root, file)}: ${label}`);
  }
}

const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
for (const dependency of ["openai", "patch-package"]) {
  if (packageJson.dependencies?.[dependency] || packageJson.devDependencies?.[dependency]) {
    violations.push(`package.json: retired dependency ${dependency}`);
  }
}
if (violations.length) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Safety-contract reset guard passed.\n");
}
