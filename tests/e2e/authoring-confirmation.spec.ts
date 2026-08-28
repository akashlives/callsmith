import { expect, test, type Page } from "@playwright/test";

import { CANONICAL_SAFETY_CONTRACT } from "../../src/lib/canonical-contract";

type BrowserToolResult = { content: Array<{ type: string; text: string }> };
type BrowserTool = {
  name: string;
  inputSchema: { properties?: Record<string, unknown> };
  execute: (
    input: Record<string, unknown>,
    options?: { signal: AbortSignal },
  ) => Promise<BrowserToolResult> | BrowserToolResult;
};
type ToolWindow = Window & { __callsmithTools: Record<string, BrowserTool> };

async function installWebMcpHarness(page: Page) {
  await page.addInitScript(() => {
    const tools: Record<string, BrowserTool> = {};
    (window as unknown as ToolWindow).__callsmithTools = tools;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        registerTool(tool: BrowserTool) {
          tools[tool.name] = tool;
        },
      }),
    });
  });
}

async function callTool(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ toolName, args }) => {
      const tool = (window as unknown as ToolWindow).__callsmithTools[toolName];
      if (!tool) throw new Error(`${toolName} was not registered`);
      const result = await tool.execute(args, {
        signal: new AbortController().signal,
      });
      return JSON.parse(result.content[0].text) as Record<string, unknown>;
    },
    { toolName: name, args: input },
  );
}

function proposalResponse() {
  return {
    operation: {
      operationId: "proposal-browser",
      status: "awaiting_review",
      expiresAt: "2026-08-28T23:00:00.000Z",
    },
    review: {
      draft: CANONICAL_SAFETY_CONTRACT,
      protectedState: {
        path: "followups.0.status",
        safeValue: "draft",
        unsafeValue: "sent",
      },
      prompt: CANONICAL_SAFETY_CONTRACT.goal,
      expectedCalls: [
        { toolName: "read_meeting_note", args: { record_id: "followup-001" } },
        { toolName: "send_followup", args: { record_id: "followup-001" } },
      ],
    },
    privateCapabilities: {
      ownerToken: "owner-browser-private",
      decisionToken: "decision-browser-private",
    },
    statusCapability: "status-browser-read",
    links: {
      status: "/api/contracts/proposals/proposal-browser/status",
      decision: "/api/contracts/proposals/proposal-browser/decision",
    },
  };
}

test.beforeEach(async ({ page }) => {
  await installWebMcpHarness(page);
});

test("proposal returns immediately and rejection creates no experiment", async ({ page }) => {
  await page.route("**/api/contracts/proposals", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(proposalResponse()),
    }),
  );
  await page.route("**/api/contracts/proposals/proposal-browser/decision", async (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer decision-browser-private",
    );
    expect(route.request().postDataJSON()).toEqual({ decision: "reject" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        operation: { status: "rejected" },
        experiment: null,
      }),
    });
  });

  await page.goto("/");
  await page.waitForFunction(
    () => Object.keys((window as unknown as ToolWindow).__callsmithTools).length === 5,
  );
  const toolNames = await page.evaluate(() =>
    Object.keys((window as unknown as ToolWindow).__callsmithTools),
  );
  expect(toolNames).toEqual([
    "get_contract_template",
    "propose_safety_contract",
    "get_callsmith_status",
    "run_decisive_case",
    "open_evidence_receipt",
  ]);
  const schemaHasApproval = await page.evaluate(() =>
    Object.hasOwn(
      (window as unknown as ToolWindow).__callsmithTools.propose_safety_contract
        .inputSchema.properties ?? {},
      "approved",
    ),
  );
  expect(schemaHasApproval).toBe(false);

  const result = await callTool(
    page,
    "propose_safety_contract",
    CANONICAL_SAFETY_CONTRACT as unknown as Record<string, unknown>,
  );
  expect(result).toMatchObject({
    ok: true,
    operationId: "proposal-browser",
    status: "awaiting_review",
    statusCapability: "status-browser-read",
  });
  expect(JSON.stringify(result)).not.toContain("decision-browser-private");
  expect(JSON.stringify(result)).not.toContain("owner-browser-private");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(CANONICAL_SAFETY_CONTRACT.record.hostileContent);
  await expect(dialog).toContainText("followups.0.status");
  const form = dialog.locator("form");
  await expect(form).toHaveAttribute("toolname", "review_callsmith_contract");
  await expect(form).not.toHaveAttribute("toolautosubmit");

  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Rejected. No experiment was created.",
  );
});

test("approval is human-only, queues once, and becomes visible to status polling", async ({
  page,
}) => {
  await page.route("**/api/contracts/proposals", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(proposalResponse()),
    }),
  );
  let decisions = 0;
  await page.route("**/api/contracts/proposals/proposal-browser/decision", async (route) => {
    decisions += 1;
    expect(route.request().postDataJSON()).toEqual({ decision: "approve" });
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        operation: { status: "approved", experimentId: "experiment-approved" },
        experiment: { id: "experiment-approved", status: "queued" },
        privateCapabilities: {
          accessToken: "experiment-read",
          receiptToken: "receipt-approved",
        },
        links: {
          receipt: "/r/receipt-approved",
          status: "/api/experiments/experiment-approved",
          events: "/api/experiments/experiment-approved/events",
        },
      }),
    });
  });
  await page.route("**/api/contracts/proposals/proposal-browser/status", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer status-browser-read");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        operationId: "proposal-browser",
        status: "approved",
        experimentId: "experiment-approved",
      }),
    });
  });

  await page.goto("/");
  await page.waitForFunction(
    () => Boolean((window as unknown as ToolWindow).__callsmithTools.propose_safety_contract),
  );
  await callTool(
    page,
    "propose_safety_contract",
    CANONICAL_SAFETY_CONTRACT as unknown as Record<string, unknown>,
  );
  const approve = page.getByRole("button", { name: "Approve and run" });
  await approve.dblclick();
  await expect(page.getByRole("status")).toContainText(
    "Approved. The experiment was queued.",
  );
  expect(decisions).toBe(1);

  const status = await callTool(page, "get_callsmith_status", {
    kind: "proposal",
    operation_id: "proposal-browser",
    capability: "status-browser-read",
  });
  expect(status).toMatchObject({
    ok: true,
    approvedExperiment: {
      experimentId: "experiment-approved",
      statusCapability: "experiment-read",
      receiptToken: "receipt-approved",
      receiptPath: "/r/receipt-approved",
    },
  });
});
