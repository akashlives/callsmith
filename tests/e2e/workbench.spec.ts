import { expect, test, type Page } from "@playwright/test";

import { decisiveReceiptFixture } from "./receipt-fixture";

const created = {
  experiment: {
    schemaVersion: 1,
    id: "experiment-e2e",
    status: "queued",
    evidenceStatus: "pending",
    model: "gpt-5.6-luna",
    seed: 606,
    attempts: [],
    receiptAvailable: false,
    updatedAt: "2026-08-28T20:00:00.000Z",
  },
  accessToken: "access-e2e",
  receiptToken: "receipt-e2e",
  links: {
    status: "/api/experiments/experiment-e2e",
    events: "/api/experiments/experiment-e2e/events",
    receipt: "/r/receipt-e2e",
  },
};

async function mockDecisiveProof(page: Page) {
  const receipt = decisiveReceiptFixture();
  await page.route("**/api/experiments", async (route) => {
    expect(route.request().postDataJSON()).toEqual({});
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify(created),
    });
  });
  await page.route("**/api/experiments/experiment-e2e/events", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer access-e2e");
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `event: progress\ndata: {"type":"attempt_completed"}\n\nevent: experiment\ndata: {"status":"completed","evidenceStatus":"conclusive","receiptAvailable":true}\n\n`,
    });
  });
  await page.route("**/api/receipts/receipt-e2e", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(receipt),
    }),
  );
}

test("a guest understands and runs the decisive safety proof", async ({ page }) => {
  await mockDecisiveProof(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page).toHaveTitle(/Callsmith/);
  await expect(
    page.getByRole("heading", {
      name: "Same untrusted meeting note.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Northstar Health").first()).toBeVisible();
  await expect(page.locator(".crm-chip.is-neutral")).toHaveCount(2);
  await expect(
    page.getByRole("heading", {
      name: "Five workbench tools here. CRM tools live on the sandbox.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Repetitions")).toHaveCount(0);
  await expect(page.getByText("/100")).toHaveCount(0);

  const runRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/experiments") &&
      request.method() === "POST",
  );
  const runButton = page.getByRole("button", { name: "Run the decisive proof" });
  await runButton.focus();
  await page.keyboard.press("Enter");
  await runRequest;

  await expect(
    page.getByRole("heading", {
      name: "Official expectedCall passed both contracts. Only one website stopped the send.",
    }),
  ).toBeVisible();
  await expect(page.locator(".crm-chip.is-risk")).toHaveText("SENT");
  await expect(page.locator(".crm-chip.is-safe")).toHaveText("DRAFT · HELD");
  await expect(page.getByText("Browser-native WebMCP evidence")).toBeVisible();

  const evidence = page.locator("#evidence");
  await evidence.getByText("Show the browser proof").click();
  await expect(evidence.getByText("Protected state changed")).toBeVisible();
  await expect(evidence.getByText("Website blocked the action")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open immutable report" })).toHaveAttribute(
    "href",
    "/r/receipt-e2e",
  );
  await expect(page.getByRole("link", { name: "Download JSON receipt" })).toHaveAttribute(
    "href",
    "/api/receipts/receipt-e2e",
  );
});

test("failure stays explicit and never reveals fabricated evidence", async ({ page }) => {
  await page.route("**/api/experiments", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Browser worker unavailable" }),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Run the decisive proof" }).click();

  await expect(page.locator(".run-error")).toContainText("Browser worker unavailable");
  await expect(
    page.getByRole("button", { name: "Retry the decisive proof" }),
  ).toBeVisible();
  await expect(page.getByText("Immutable safety receipt")).toHaveCount(0);
});

test("theme, keyboard, reduced motion, and responsive layout remain usable", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("h1")).toHaveCount(1);

  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  const button = page.getByRole("button", { name: "Run the decisive proof" });
  await expect(button).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  expect(consoleErrors.filter((message) => /hydration/i.test(message))).toEqual([]);
});

test("receipt route leads with the CRM pair, SHA-256, and a closed developer appendix", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "One desktop screenshot is enough for the visual proof.",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".crm-chip.is-neutral").first()).toHaveText("RECORD");
  await page.screenshot({ path: "docs/visual-2026-home.png" });

  await page.goto("/r/receipt-e2e");
  await expect(page.locator(".crm-chip.is-risk")).toHaveText("SENT");
  await expect(page.locator(".crm-chip.is-safe")).toHaveText("DRAFT · HELD");
  await expect(page.locator(".sha-first code")).toHaveText(/^[a-f0-9]{64}$/);
  await expect(
    page.getByRole("heading", {
      name: "Official expectedCall passed both contracts. Only one website stopped the send.",
    }),
  ).toBeVisible();
  await expect(page.locator("details.evidence-disclosure")).not.toHaveAttribute("open");
  await page.screenshot({ path: "docs/visual-2026-receipt.png" });
});
