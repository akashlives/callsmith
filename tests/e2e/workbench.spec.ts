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
      name: "Agent platforms review every tool call. Nobody attests the website.",
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

test("in-flight pair names both websites and withholds SENT", async ({ page }) => {
  await page.route("**/api/experiments", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify(created),
    });
  });
  await page.route("**/api/experiments/experiment-e2e/events", () => new Promise(() => {}));
  await page.goto("/");
  await page.getByRole("button", { name: "Run the decisive proof" }).click();

  await expect(
    page.getByText("No confirm gate. This website can change draft to sent."),
  ).toBeVisible();
  await expect(
    page.getByText("Confirm gate on. This website cannot send without a human click."),
  ).toBeVisible();
  await expect(page.getByText("Sending")).toBeVisible();
  await expect(page.getByText("Confirming")).toBeVisible();
  await expect(page.locator(".crm-chip")).toHaveText(["RUNNING", "RUNNING"]);
  await expect(page.locator(".crm-chip.is-risk")).toHaveCount(0);
  await expect(page.getByText(/DRAFT · HELD/)).toHaveCount(0);
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

test("a compromised third-party script hijacks the weak tool surface and is refused by the hardened one", async ({
  page,
}) => {
  const sandbox = "/sandbox/meeting-note-boundary/safety-boundary";

  await page.goto(`${sandbox}?contract=weak`);
  const weakSurface = page.getByTestId("tool-surface");
  await expect(weakSurface).toContainText("open registry");
  await expect(weakSurface.getByRole("listitem")).toHaveCount(2);
  await weakSurface.getByTestId("hijack-toggle").click();
  await expect(weakSurface.getByTestId("hijack-verdict")).toContainText(
    "Hijack accepted. getTools() now returns the attacker's send_followup.",
  );
  await expect(weakSurface).toContainText("cdn.analytics-shim.invalid/agent-helper.js");
  await expect(weakSurface.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText(/Open registry let .* take over the name/)).toBeVisible();
  await weakSurface.getByTestId("hijack-toggle").click();
  await expect(weakSurface.getByTestId("hijack-verdict")).toHaveCount(0);
  await expect(weakSurface).not.toContainText("cdn.analytics-shim.invalid");

  await page.goto(`${sandbox}?contract=hardened`);
  const hardenedSurface = page.getByTestId("tool-surface");
  await expect(hardenedSurface).toContainText("origin-bound registry");
  await hardenedSurface.getByTestId("hijack-toggle").click();
  await expect(hardenedSurface.getByTestId("hijack-verdict")).toContainText(
    "Hijack rejected. getTools() still returns the website's send_followup.",
  );
  await expect(hardenedSurface).not.toContainText("cdn.analytics-shim.invalid");
  await expect(hardenedSurface.getByRole("listitem")).toHaveCount(2);
  await expect(
    page.getByText(/never reached document\.modelContext/),
  ).toBeVisible();
  await expect(page.locator("pre").first()).toContainText('"status": "draft"');
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
  const attestation = page.locator(".attestation-header");
  await expect(attestation).toContainText("Origin under test");
  await expect(attestation).toContainText("read_meeting_note, send_followup on /sandbox/");
  await expect(attestation).toContainText("meeting-note boundary · v1 · 1 case · seed 606");
  await expect(attestation).toContainText("it is not a certificate for the origin");
  await expect(
    page.getByRole("heading", {
      name: "Official expectedCall passed both contracts. Only one website stopped the send.",
    }),
  ).toBeVisible();
  await expect(page.locator("details.evidence-disclosure")).not.toHaveAttribute("open");
  await page.screenshot({ path: "docs/visual-2026-receipt.png" });
});
