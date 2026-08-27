import { expect, test } from "@playwright/test";

const liveDeployment = Boolean(process.env.PLAYWRIGHT_BASE_URL);

test.describe("live deployment evidence", () => {
  test.skip(!liveDeployment, "Runs only against an explicitly selected deployed environment.");

  test("one real browser run reaches an honest terminal evidence state", async ({ page }) => {
    test.skip(test.info().project.name !== "chromium", "One paid live run is sufficient; mobile remains covered by non-mutating checks.");
    test.setTimeout(75_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const runRequest = page.waitForRequest(
      (request) => request.url().endsWith("/api/runs") && request.method() === "POST",
    );
    await page.getByRole("button", { name: "Run the safety test" }).click();
    const request = await runRequest;
    const createResponse = await request.response();
    expect(createResponse).not.toBeNull();

    expect(request.postDataJSON()).toMatchObject({
      suiteId: "sales-follow-through",
      scenarioId: "injection-confirmation",
      models: ["gpt-5.6-luna"],
      contractVariants: ["weak", "hardened"],
      repetitions: 1,
      seed: 606,
      provenance: "browser_webmcp",
    });

    const created = (await createResponse!.json()) as { id?: string; error?: string };
    if (!createResponse!.ok()) {
      await expect(page.locator(".run-error")).toContainText(created.error ?? "The check stopped safely.");
      await expect(page.getByRole("button", { name: "Retry the safety test" })).toBeVisible();
      await expect(page.getByText("The verdict", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Deterministic preview evidence")).toHaveCount(0);
      return;
    }
    expect(created.id).toBeTruthy();

    await expect(
      page.getByRole("heading", {
        name: "Same agent. One website let it cross the line.",
      }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Deterministic preview evidence")).toHaveCount(0);
    await expect(page.getByText("The verdict", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sent without approval" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Human boundary respected" })).toBeVisible();
    await expect(page.getByText("Live browser replication", { exact: true })).toBeVisible();

    const runResponse = await page.request.get(`/api/runs/${encodeURIComponent(created.id!)}`);
    expect(runResponse.ok()).toBe(true);
    const run = (await runResponse.json()) as {
      evidenceStatus: string;
      attempts: Array<{ contractVariant: string; model: string; seed: number; provenance: string }>;
    };
    expect(run.evidenceStatus).toBe("conclusive");
    expect(run.attempts).toHaveLength(2);
    expect(new Set(run.attempts.map((attempt) => attempt.contractVariant))).toEqual(
      new Set(["weak", "hardened"]),
    );
    expect(new Set(run.attempts.map((attempt) => `${attempt.model}:${attempt.seed}`)).size).toBe(1);
    expect(run.attempts.every((attempt) => attempt.provenance === "browser_webmcp")).toBe(true);
  });
});
