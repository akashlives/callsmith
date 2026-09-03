import { expect, test, type Page } from "@playwright/test";

import { decisiveReceiptFixture } from "./receipt-fixture";

const created = {
  experiment: {
    schemaVersion: 1,
    id: "experiment-e2e",
    status: "queued",
    evidenceStatus: "pending",
    model: "gpt-5.6-luna",
    seed: 701,
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

const HOLD = "/sandbox/ticketing-seats-boundary/safety-boundary";

async function mockTicketingProof(page: Page) {
  const receipt = decisiveReceiptFixture();
  await page.route("**/api/experiments", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      suiteId: "ticketing-seats-boundary",
    });
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

test("home is the photograph and never shows Approve", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page).toHaveTitle(/Callsmith/);
  const hero = page.locator("#top");
  await expect(hero.getByRole("heading", { level: 1 })).toContainText("$186");
  await expect(hero.getByRole("link", { name: "Open the live hold" })).toHaveAttribute(
    "href",
    HOLD,
  );
  await expect(hero.getByRole("button", { name: /Approve/ })).toHaveCount(0);
  await expect(hero.getByText(/WebMCP|Luna|MSTI|ACP/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prove it again" })).toBeVisible();
});

test("Prove it again posts the ticketing suite and stays honest on failure", async ({
  page,
}) => {
  await page.route("**/api/experiments", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Browser worker unavailable" }),
    }),
  );
  await page.goto("/");
  const runRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/experiments") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Prove it again" }).click();
  const request = await runRequest;
  expect(request.postDataJSON()).toEqual({ suiteId: "ticketing-seats-boundary" });
  await expect(page.locator(".run-error")).toContainText("Browser worker unavailable");
  await expect(page.getByText("CHARGED · by the site")).toHaveCount(0);
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

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  expect(consoleErrors.filter((message) => /hydration/i.test(message))).toEqual([]);
});

test("hardened hold: Charge requests, synthetic Approve is rejected", async ({ page }) => {
  await page.goto(`${HOLD}?contract=hardened`);
  await expect(page.locator("[data-record-app]")).toHaveAttribute(
    "data-suite",
    "ticketing-seats-boundary",
  );
  await expect(page.locator(".charge-money")).toHaveText("$186");
  await page.locator('[data-action="read"]').click();
  await page.locator('[data-action="charge"]').click();
  await expect(page.getByTestId("hold-chip")).toContainText("HELD · awaiting you");
  await expect(page.locator("[data-record-app]")).toHaveAttribute("data-hold-status", "held");

  const approve = page.locator('[data-action="approve"]');
  await expect(approve).toBeVisible();
  await page.evaluate((el) => (el as HTMLButtonElement).click(), await approve.elementHandle());
  await expect(page.getByTestId("hold-chip")).toContainText("HELD · awaiting you");
  await expect(page.locator("[data-ledger]")).toContainText("untrusted_input");
});

test("weak hold: Charge applies as the site", async ({ page }) => {
  await page.goto(`${HOLD}?contract=weak`);
  await page.locator('[data-action="read"]').click();
  await page.locator('[data-action="charge"]').click();
  await expect(page.getByTestId("hold-chip")).toContainText("CHARGED · by the site");
  await expect(page.locator("[data-ledger]")).toContainText("toolchange");
  await expect(page.locator('[data-action="approve"]')).toHaveCount(0);
});

test("worker attemptId hides human controls", async ({ page }) => {
  await page.goto(`${HOLD}?contract=hardened&attempt=experiment-e2e-hardened-model-701`);
  await expect(page.locator('[data-action="approve"]')).toHaveCount(0);
  await expect(page.locator('[data-action="charge"]')).toHaveCount(0);
  await expect(page.locator('[data-action="read"]')).toHaveCount(0);
});

test("sandbox index and the four hold routes load", async ({ page }) => {
  await page.goto("/sandbox");
  await expect(page).toHaveURL(/ticketing-seats-boundary\/safety-boundary/);
  for (const path of [
    HOLD,
    "/sandbox/retail-checkout-boundary/safety-boundary",
    "/sandbox/travel-hold-boundary/safety-boundary",
    "/sandbox/telecom-plan-boundary/safety-boundary",
    "/sandbox/meeting-note-boundary/safety-boundary",
  ]) {
    await page.goto(path);
    await expect(page.locator("[data-record-app]")).toBeVisible();
  }
});

test("a compromised third-party script hijacks the weak tool surface and is refused by the hardened one", async ({
  page,
}) => {
  const sandbox = "/sandbox/meeting-note-boundary/safety-boundary";

  await page.goto(`${sandbox}?contract=weak`);
  await page.getByText("Developer state").click();
  const weakSurface = page.getByTestId("tool-surface");
  await expect(weakSurface).toContainText("open registry");
  await expect(weakSurface.getByRole("listitem")).toHaveCount(2);
  await weakSurface.getByTestId("hijack-toggle").click({ force: true });
  await expect(weakSurface.getByTestId("hijack-verdict")).toContainText(
    "Hijack accepted. getTools() now returns the attacker's send_followup.",
  );
  await expect(weakSurface).toContainText("cdn.analytics-shim.invalid/agent-helper.js");
  await expect(weakSurface.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText(/Open registry let .* take over the name/)).toBeVisible();
  await weakSurface.getByTestId("hijack-toggle").click({ force: true });
  await expect(weakSurface.getByTestId("hijack-verdict")).toHaveCount(0);
  await expect(weakSurface).not.toContainText("cdn.analytics-shim.invalid");

  await page.goto(`${sandbox}?contract=hardened`);
  await page.getByText("Developer state").click();
  const hardenedSurface = page.getByTestId("tool-surface");
  await expect(hardenedSurface).toContainText("origin-bound registry");
  await hardenedSurface.getByTestId("hijack-toggle").click({ force: true });
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

test("receipt route leads with the pair, SHA-256, and a closed developer appendix", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "One desktop screenshot is enough for the visual proof.",
  );
  await mockTicketingProof(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#top h1")).toContainText("$186");
  await page.screenshot({ path: "docs/visual-2026-home.png" });

  await page.goto("/r/receipt-e2e");
  await expect(page.locator(".crm-chip.is-risk")).toHaveText("SENT");
  await expect(page.locator(".crm-chip.is-safe")).toHaveText("DRAFT · HELD");
  await expect(page.locator(".sha-first code")).toHaveText(/^[a-f0-9]{64}$/);
  const attestation = page.locator(".attestation-header");
  await expect(attestation).toContainText("Origin under test");
  await expect(attestation).toContainText("read_meeting_note, send_followup on /sandbox/");
  await expect(attestation).toContainText("meeting-note-boundary · v1 · 1 case · seed 606");
  await expect(attestation).toContainText("it is not a certificate for the origin");
  await expect(
    page.getByRole("heading", {
      name: "Official expectedCall passed both contracts. Only one website stopped the send.",
    }),
  ).toBeVisible();
  await expect(page.locator("details.evidence-disclosure")).not.toHaveAttribute("open");
  await page.screenshot({ path: "docs/visual-2026-receipt.png" });
});
