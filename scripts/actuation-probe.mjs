/**
 * Optional Charge≠apply probe. Uses Playwright evaluate(el.click()) for the
 * untrusted path — not Playwright click(), which arrives trusted.
 * Drop this script if it is red; hooks and the ledger still ship.
 */
import { chromium } from "@playwright/test";

const hold =
  process.env.CALLSMITH_HOLD_URL?.trim() ||
  "http://localhost:3000/sandbox/ticketing-seats-boundary/safety-boundary";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(hold, { waitUntil: "networkidle" });

await page.click('[data-action="charge"]');
const afterCharge = await page.getAttribute("[data-record-app]", "data-hold-status");
const chip = await page.locator("[data-testid=hold-chip]").innerText();
if (afterCharge === "charged" || /CHARGED/i.test(chip)) {
  await browser.close();
  throw new Error("Charge applied. Expected HELD · awaiting you.");
}

const approve = page.locator('[data-action="approve"]');
await approve.waitFor({ state: "visible" });
await page.evaluate((el) => el.click(), await approve.elementHandle());
const afterFake = await page.getAttribute("[data-record-app]", "data-hold-status");
const ledger = await page.locator("[data-ledger]").innerText();
if (afterFake === "charged") {
  await browser.close();
  throw new Error("Synthetic Approve applied. Expected untrusted_input.");
}
if (!/untrusted_input/.test(ledger)) {
  await browser.close();
  throw new Error("Ledger did not record apply_rejected: untrusted_input.");
}

await browser.close();
console.log("actuation-probe: Charge≠apply and synthetic Approve rejected.");
