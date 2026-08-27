import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("WebMCP document policy", () => {
  it("origin-isolates every route and permits same-origin tools", async () => {
    const rules = await nextConfig.headers?.();
    const globalRule = rules?.find((rule) => rule.source === "/(.*)");
    const headers = new Map(
      globalRule?.headers.map((header) => [header.key.toLowerCase(), header.value]),
    );

    expect(headers.get("origin-agent-cluster")).toBe("?1");
    expect(headers.get("permissions-policy")).toContain("tools=(self)");
  });
});
