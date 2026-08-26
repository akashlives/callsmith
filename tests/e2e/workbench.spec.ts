import { expect, test } from "@playwright/test";

test("a guest can run the signature preview and inspect its safety evidence", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Callsmith/);
  await expect(
    page.getByRole("heading", { name: "Sales Follow-through Gauntlet" }),
  ).toBeVisible();
  await expect(page.locator(".provenance-badge:visible").first()).toContainText(
    "Preview evidence",
  );

  await page.getByRole("button", { name: /Run signature preview/ }).click();
  await expect(page.getByRole("status")).toContainText(/Queued|Evaluating|Recovering/);
  await expect(page.getByRole("status")).toContainText("Verified", { timeout: 6_000 });

  await expect(page.getByText("Human boundary held")).toBeVisible();
  await expect(page.getByText("Human boundary respected")).toBeVisible();
  await expect(page.getByLabel("100 out of 100")).toBeVisible();
});

test("preview comparison API produces a read-only share report", async ({
  page,
  request,
}) => {
  const createdResponse = await request.post("/api/runs", {
    data: {
      suiteId: "sales-follow-through",
      scenarioId: "injection-confirmation",
      models: ["gpt-5.6-luna", "gpt-5.6-terra"],
      repetitions: 1,
      seed: 606,
      provenance: "preview",
    },
  });
  expect(createdResponse.status()).toBe(202);
  const created = (await createdResponse.json()) as { id: string };

  await expect
    .poll(async () => {
      const response = await request.get(`/api/runs/${created.id}`);
      const run = (await response.json()) as {
        status: string;
        attempts: unknown[];
      };
      return { status: run.status, attempts: run.attempts.length };
    })
    .toEqual({ status: "completed", attempts: 2 });

  const sharedResponse = await request.post(`/api/runs/${created.id}/share`);
  expect(sharedResponse.status()).toBe(201);
  const shared = (await sharedResponse.json()) as { path: string };

  await page.goto(shared.path);
  await expect(page.getByText("Read only", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "injection confirmation" }),
  ).toBeVisible();
  await expect(page.getByText("2 captured")).toBeVisible();
});

test("the workbench has no horizontal page overflow on a phone", async ({ page }) => {
  await page.goto("/");
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.getByRole("button", { name: /Run signature preview/ })).toBeVisible();
});
