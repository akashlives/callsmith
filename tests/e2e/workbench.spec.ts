import { expect, test } from "@playwright/test";

const liveDeployment = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const coldRouteTimeout = 30_000;

test("a guest understands and runs the story-first safety comparison", async ({ page }) => {
  test.skip(liveDeployment, "The external-deployment smoke test owns the single live model run.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page).toHaveTitle(/Callsmith/);
  await expect(
    page.getByRole("heading", { name: "Catch unsafe agent behavior before you ship." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "The meeting-note trap." })).toBeVisible();
  await expect(page.getByText("Meeting handoff note")).toBeVisible();
  await expect(page.getByText("Suite JSON")).toHaveCount(0);
  await expect(page.getByText("Repetitions")).toHaveCount(0);

  const runRequest = page.waitForRequest(
    (request) => request.url().endsWith("/api/runs") && request.method() === "POST",
  );
  const runButton = page.getByRole("button", { name: "Run the safety test" });
  await runButton.focus();
  await page.keyboard.press("Enter");

  const request = await runRequest;
  const liveRunner = await page
    .getByText("Browser WebMCP · one model · two contracts")
    .isVisible()
    .catch(() => false);
  expect(request.postDataJSON()).toMatchObject({
    suiteId: "sales-follow-through",
    scenarioId: "injection-confirmation",
    models: ["gpt-5.6-luna"],
    contractVariants: ["weak", "hardened"],
    repetitions: 1,
    seed: 606,
    provenance: liveRunner ? "browser_webmcp" : "deterministic_preview",
  });

  await expect(
    page.getByRole("heading", {
      name: "Same agent. One website let it cross the line.",
    }),
  ).toBeVisible({ timeout: coldRouteTimeout });
  await expect(page.getByRole("heading", { name: "Sent without approval" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Human boundary respected" }),
  ).toBeVisible();
  await expect(page.getByText("Deterministic preview evidence")).toBeVisible();

  const evidenceSummary = page.locator("#evidence > summary");
  await evidenceSummary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("The agent crossed the line", { exact: true })).toBeVisible();
  await expect(page.getByText("The agent stopped for approval", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /One workbench/ })).toBeVisible();
});

test("the judge gets one copyable prompt for the agent-to-report journey", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Turn one prompt into a safety report." }),
  ).toBeVisible();
  const journeySteps = page.getByRole("list", {
    name: "Agent-to-report journey",
  });
  await expect(
    journeySteps.getByRole("listitem").filter({ hasText: "Agent authors" }),
  ).toBeVisible();
  await expect(
    journeySteps.getByRole("listitem").filter({ hasText: "You approve" }),
  ).toBeVisible();
  await expect(
    journeySteps.getByRole("listitem").filter({ hasText: "Callsmith proves" }),
  ).toBeVisible();
  await expect(page.locator(".agent-prompt-card blockquote")).toContainText(
    "customer-support safety gauntlet",
  );
  await expect(page.locator(".agent-prompt-card blockquote")).toContainText(
    "never claim I approved",
  );

  await page.getByRole("button", { name: "Copy agent prompt" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Ready to paste into an agent on this page.",
  );
});

test("the story creates and opens a read-only narrative report", async ({ page }) => {
  test.skip(liveDeployment, "The external-deployment smoke test owns the single live model run.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Run the safety test" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Same agent. One website let it cross the line.",
    }),
  ).toBeVisible({ timeout: coldRouteTimeout });

  await page.getByRole("button", { name: "Create report link" }).click();
  const reportLink = page.getByRole("link", { name: /Open read-only report/ });
  await expect(reportLink).toBeVisible({ timeout: coldRouteTimeout });
  await reportLink.click();

  await expect(page.getByText("Read only", { exact: true })).toBeVisible({
    timeout: coldRouteTimeout,
  });
  await expect(
    page.getByRole("heading", {
      name: "Same agent. One website let it cross the line.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create report link" })).toHaveCount(0);
  await expect(page.getByText("Assertions passed")).toBeVisible();
});

test("theme follows the system, persists an override, and avoids hydration errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  expect(consoleErrors.filter((message) => /hydration/i.test(message))).toEqual([]);
});

test("a failed start explains the problem and offers a retry without fake evidence", async ({ page }) => {
  await page.route("**/api/runs", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic runner unavailable" }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Run the safety test" }).click();

  await expect(page.locator(".run-error")).toContainText("Synthetic runner unavailable");
  await expect(page.getByRole("button", { name: "Retry the safety test" })).toBeVisible();
  await expect(
    page.getByText("Same agent. One website let it cross the line."),
  ).toHaveCount(0);
});

test("the narrative has one h1 and never overflows the viewport", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveCount(1);
  const runButton = page.getByRole("button", { name: "Run the safety test" });
  await expect(runButton).toBeVisible();

  const buttonBox = await runButton.boundingBox();
  const viewport = page.viewportSize();
  expect(buttonBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(viewport!.height);

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});
