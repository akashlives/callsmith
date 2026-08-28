import { describe, expect, it } from "vitest";

import { frameworkManifest } from "@/lib/framework-manifest";

describe("framework manifest", () => {
  it("records installed versions and a stable revision", async () => {
    const first = await frameworkManifest();
    const second = await frameworkManifest();
    expect(second).toEqual(first);
    expect(first.node).toBe(process.version);
    expect(first.applicationRevision).toBe("development");
    expect(first.packages).toMatchObject({
      next: "16.3.3",
      react: "19.2.8",
      typescript: "5.9.3",
      "webmcp-evals": "0.0.4",
    });
    expect(first.revision).toMatch(/^[a-f0-9]{64}$/);
  });
});
