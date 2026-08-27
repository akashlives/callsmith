import { expect, test, type Page } from "@playwright/test";

import { compileGuidedSuiteDraft } from "../../src/lib/suite-compiler";
import supportFixture from "../fixtures/guided-suite/support.json" with { type: "json" };

const liveDeployment = Boolean(process.env.PLAYWRIGHT_BASE_URL);

type BrowserToolResult = {
  content: Array<{ type: string; text: string }>;
};

type BrowserTool = {
  execute: (
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => Promise<BrowserToolResult> | BrowserToolResult;
};

type ToolTestWindow = Window & {
  __callsmithTools: Record<string, BrowserTool>;
  __callsmithToolRun?: {
    controller: AbortController;
    result: Promise<BrowserToolResult>;
  };
};

async function installWebMcpHarness(page: Page) {
  await page.addInitScript(() => {
    const tools: Record<string, BrowserTool> = {};
    const testWindow = window as unknown as ToolTestWindow;
    testWindow.__callsmithTools = tools;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        registerTool(tool: BrowserTool & { name: string }) {
          tools[tool.name] = tool;
        },
      }),
    });
  });
}

async function startAuthoringTool(page: Page, id: string) {
  await page.evaluate(
    ({ fixture, suiteId }) => {
      const testWindow = window as unknown as ToolTestWindow;
      const tool = testWindow.__callsmithTools.draft_and_run_suite;
      if (!tool) throw new Error("draft_and_run_suite was not registered");
      const controller = new AbortController();
      testWindow.__callsmithToolRun = {
        controller,
        result: Promise.resolve(
          tool.execute({ ...fixture, id: suiteId }, { signal: controller.signal }),
        ),
      };
    },
    { fixture: supportFixture, suiteId: id },
  );
}

async function toolResult(page: Page) {
  const result = await page.evaluate(async () => {
    const run = (window as unknown as ToolTestWindow).__callsmithToolRun;
    if (!run) throw new Error("No authoring tool run is pending");
    return run.result;
  });
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

test("browser WebMCP authoring remains behind the human confirmation boundary", async ({
  page,
}, testInfo) => {
  test.skip(liveDeployment, "Staging Browser Use owns the live authoring acceptance gate.");
  await installWebMcpHarness(page);

  let mode: "normal" | "approval" | "stale" = "normal";
  const apiCalls: string[] = [];
  await page.route("**/api/suite-drafts**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    apiCalls.push(path);
    if (path === "/api/suite-drafts") {
      const body = request.postDataJSON() as { draft: typeof supportFixture };
      const candidateSuite = compileGuidedSuiteDraft(body.draft);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          draft: {
            id: "draft-browser-e2e",
            status: "awaiting_confirmation",
            candidateSuite,
          },
          ownerToken: "cs_owner_browser_private",
          confirmationToken: "cs_confirm_browser_private",
          confirmationExpiresAt: new Date(
            Date.now() + (mode === "stale" ? -1_000 : 60_000),
          ).toISOString(),
          links: {
            approveAndRun:
              "/api/suite-drafts/draft-browser-e2e/approve-and-run",
            reject: "/api/suite-drafts/draft-browser-e2e/reject",
          },
        }),
      });
      return;
    }
    if (path.endsWith("/approve-and-run")) {
      expect(mode).toBe("approval");
      expect(request.headers().authorization).toBe(
        "Bearer cs_owner_browser_private",
      );
      expect(request.headers()["x-callsmith-confirmation-token"]).toBe(
        "cs_confirm_browser_private",
      );
      // Keep the approving state observable in both desktop and mobile while
      // the double click proves that only one mutation request can escape.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          run: { id: "run-browser-human-approved", status: "queued" },
          report: {
            token: "browser-agent-report-token-123456",
            path: "/r/browser-agent-report-token-123456",
            url: "http://callsmith.test/r/browser-agent-report-token-123456",
            readOnly: true,
            status: "queued",
            evidenceStatus: "pending",
          },
        }),
      });
      return;
    }
    if (path.endsWith("/reject")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ rejected: true, runCreated: false }),
      });
      return;
    }
    await route.abort();
  });

  await page.goto("/");
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as ToolTestWindow).__callsmithTools
          .draft_and_run_suite,
      ),
  );

  const fabricated = await page.evaluate(async (fixture) => {
    const tool = (window as unknown as ToolTestWindow).__callsmithTools
      .draft_and_run_suite;
    const result = await tool.execute(
      { ...fixture, id: "browser-fabricated-approval", approved: true },
      { signal: new AbortController().signal },
    );
    return JSON.parse(result.content[0].text) as Record<string, unknown>;
  }, supportFixture);
  expect(fabricated).toMatchObject({
    ok: false,
    status: "invalid_request",
    code: "invalid_draft",
  });
  expect(apiCalls).toHaveLength(0);

  mode = "normal";
  await startAuthoringTool(
    page,
    `browser-reject-${testInfo.project.name.replace(/[^a-z0-9]+/g, "-")}`,
  );
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Hostile content fixture");
  await expect(dialog).toContainText("Protected state boundary");
  await expect(dialog).toContainText("Confirmation required");
  await expect(dialog).toContainText("Derived assertions");
  await page.getByRole("button", { name: "Reject suite" }).click();
  expect(await toolResult(page)).toMatchObject({
    ok: false,
    status: "rejected",
    code: "human_rejected",
  });
  expect(apiCalls.filter((path) => path.endsWith("/approve-and-run"))).toHaveLength(0);

  mode = "approval";
  await startAuthoringTool(
    page,
    `browser-approve-${testInfo.project.name.replace(/[^a-z0-9]+/g, "-")}`,
  );
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Approve suite" }).dblclick();
  await expect(page.getByRole("button", { name: "Approving…" })).toBeDisabled();
  expect(await toolResult(page)).toMatchObject({
    ok: true,
    status: "approved",
    run: {
      runId: "run-browser-human-approved",
      runStatus: "queued",
      reportPath: "/r/browser-agent-report-token-123456",
    },
  });
  expect(apiCalls.filter((path) => path.endsWith("/approve-and-run"))).toHaveLength(1);

  mode = "normal";
  await startAuthoringTool(
    page,
    `browser-abort-${testInfo.project.name.replace(/[^a-z0-9]+/g, "-")}`,
  );
  await expect(dialog).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as ToolTestWindow).__callsmithToolRun?.controller.abort(),
  );
  expect(await toolResult(page)).toMatchObject({
    ok: false,
    status: "aborted",
    code: "request_aborted",
  });

  await startAuthoringTool(
    page,
    `browser-navigation-${testInfo.project.name.replace(/[^a-z0-9]+/g, "-")}`,
  );
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  expect(await toolResult(page)).toMatchObject({
    ok: false,
    status: "aborted",
    code: "navigation",
  });

  mode = "stale";
  await startAuthoringTool(
    page,
    `browser-stale-${testInfo.project.name.replace(/[^a-z0-9]+/g, "-")}`,
  );
  expect(await toolResult(page)).toMatchObject({
    ok: false,
    status: "stale_draft",
    code: "stale_draft",
  });
  expect(apiCalls.filter((path) => path.endsWith("/approve-and-run"))).toHaveLength(1);
  expect(apiCalls.filter((path) => path.endsWith("/reject")).length).toBeGreaterThanOrEqual(4);
});
