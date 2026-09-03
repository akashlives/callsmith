import { expect, test } from "@playwright/test";

const liveDeployment = Boolean(process.env.PLAYWRIGHT_BASE_URL);

test.describe("live deployment evidence", () => {
  test.skip(!liveDeployment, "Runs only against an explicitly selected deployed environment.");

  test("one real matched pair yields a browser-native immutable receipt", async ({ page }) => {
    test.skip(
      test.info().project.name !== "chromium",
      "One paid live run is sufficient; mobile remains covered by non-mutating checks.",
    );
    test.setTimeout(75_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const createRequest = page.waitForRequest(
      (request) =>
        request.url().endsWith("/api/experiments") &&
        request.method() === "POST",
    );
    await page.getByRole("button", { name: "Prove it again" }).click();
    const request = await createRequest;
    expect(request.postDataJSON()).toEqual({ suiteId: "ticketing-seats-boundary" });
    const response = await request.response();
    expect(response).not.toBeNull();
    const created = (await response!.json()) as {
      error?: string;
      experiment?: { id: string };
      accessToken?: string;
      receiptToken?: string;
      links?: { status: string };
    };

    if (!response!.ok()) {
      await expect(page.getByRole("alert")).toContainText(
        created.error ?? "No safety verdict was issued.",
      );
      await expect(
        page.getByRole("button", { name: "Retry the pair" }),
      ).toBeVisible();
      await expect(page.getByText("CHARGED · by the site")).toHaveCount(0);
      return;
    }

    await expect(
      page.getByRole("heading", {
        name: "Same hold. One website charged. The other held it for you.",
      }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("CHARGED · by the site")).toBeVisible();
    await expect(page.getByText("HELD · awaiting you").first()).toBeVisible();

    const statusResponse = await page.request.get(created.links!.status, {
      headers: { authorization: `Bearer ${created.accessToken}` },
    });
    expect(statusResponse.ok()).toBe(true);
    const status = (await statusResponse.json()) as {
      evidenceStatus: string;
      attempts: Array<{
        contractVariant: string;
        status: string;
        facts?: { protectedState: string; harmPrevention: string };
      }>;
      receiptAvailable: boolean;
    };
    expect(status.evidenceStatus).toBe("conclusive");
    expect(status.receiptAvailable).toBe(true);
    expect(status.attempts).toHaveLength(2);
    expect(new Set(status.attempts.map((attempt) => attempt.contractVariant))).toEqual(
      new Set(["weak", "hardened"]),
    );

    const receiptResponse = await page.request.get(
      `/api/receipts/${encodeURIComponent(created.receiptToken!)}`,
    );
    expect(receiptResponse.ok()).toBe(true);
    const receipt = (await receiptResponse.json()) as {
      conclusion: string;
      contentHash: string;
      weak: { execution: { webMcpRunner: string } };
      hardened: { execution: { webMcpRunner: string } };
    };
    expect(receipt.conclusion).toBe("hardened_prevented_harm");
    expect(receipt.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.weak.execution.webMcpRunner).toBe("webmcp-evals");
    expect(receipt.hardened.execution.webMcpRunner).toBe("webmcp-evals");
  });
});
