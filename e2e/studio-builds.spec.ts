import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import studio from "../src/i18n/messages/en/studio.json";
import studioHome from "../src/i18n/messages/en/studioHome.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";

// "Build it 100 times" on the 555 blinker starter: its frequency is measured on the output pin over 100 builds with
// every part drawn from its tolerance, in a worker, and a build can be opened in the normal run view.

const B = studio.builds;
const BUDGET_MS = 30_000;

async function open(page: Page): Promise<Locator> {
  await page.goto("/en/studio");
  await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${studioHome.starters["blinker-555"].title}`) }).click();
  await page.getByRole("tab", { name: studio.rail.builds, exact: true }).click();
  return page.getByTestId("builds-panel");
}

async function measureFrequency(panel: Locator, { from = "0.9", to = "1.1", seconds = "2" } = {}) {
  await panel.getByLabel(B.quantity.label).selectOption("hz");
  await panel.getByLabel(B.where.volts).selectOption({ label: "U2 3" });
  await panel.getByLabel(B.time.label).fill(seconds);
  await panel.getByLabel(B.range.min, { exact: true }).fill(from);
  await panel.getByLabel(B.range.max, { exact: true }).fill(to);
}

const readHz = (text: string) => Number.parseFloat(text.replace(/[^\d.]/g, ""));

test.describe("Build it 100 times", () => {
  test("measures the 555 frequency over 100 builds in under 30 seconds, with the spread, the pass rate and no burnt part", async ({ page }) => {
    const panel = await open(page);
    await measureFrequency(panel);
    const started = Date.now();
    await panel.getByRole("button", { name: B.run }).click();
    await expect(panel.getByTestId("builds-results")).toBeVisible({ timeout: BUDGET_MS });
    expect(Date.now() - started).toBeLessThan(BUDGET_MS);

    const stats = panel.getByTestId("builds-stats");
    const lowest = readHz(await stats.getByText(/Hz$/).first().innerText());
    const highest = readHz(await stats.getByText(/Hz$/).nth(2).innerText());
    const median = readHz(await stats.getByText(/Hz$/).nth(1).innerText());
    // 1.44 / ((1 k + 2 x 68 k) x 10 uF) is 1.05 Hz, which 20 percent on the capacitor and 5 percent on the resistors spread
    expect(median).toBeGreaterThan(0.95);
    expect(median).toBeLessThan(1.2);
    expect(lowest).toBeLessThan(0.95);
    expect(highest).toBeGreaterThan(1.15);
    expect(highest).toBeLessThan(1.4);
    await expect(stats.getByText(/^\d+ of 100$/)).toBeVisible();
    expect(await panel.getByTestId("build-bar").count()).toBeGreaterThan(5);
    await expect(panel.getByText(B.results.burntNone)).toBeVisible();
    await expect(panel.getByText(/^100 builds took [\d.]+ s$/)).toBeVisible();
  });

  test("gives the same hundred builds the second time", async ({ page }) => {
    const panel = await open(page);
    await measureFrequency(panel);
    const results = async () => {
      await panel.getByRole("button", { name: B.run }).click();
      await expect(panel.getByTestId("builds-results")).toBeVisible({ timeout: BUDGET_MS });
      return [await panel.getByTestId("builds-stats").innerText(), await panel.getByTestId("build-bar").evaluateAll((bars) => bars.map((b) => b.getAttribute("aria-label")))] as const;
    };
    const first = await results();
    await panel.getByLabel(B.quantity.label).selectOption("volts");
    await panel.getByLabel(B.quantity.label).selectOption("hz");
    await measureFrequency(panel);
    expect(await results()).toEqual(first);
  });

  test("a bar opens one of its builds in the run view, and the nominal parts come back", async ({ page }) => {
    const panel = await open(page);
    await measureFrequency(panel);
    await panel.getByRole("button", { name: B.run }).click();
    await expect(panel.getByTestId("builds-results")).toBeVisible({ timeout: BUDGET_MS });
    await panel.getByTestId("build-bar").nth(2).click();
    await expect(page.getByText(studioRun.phase.running).first()).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText(/^Build \d+ of 100 is open, seed [\d,]+\.$/)).toBeVisible();
    await expect(page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true })).toHaveAttribute("aria-selected", "true");
    await panel.getByRole("button", { name: B.open.back }).click();
    await expect(panel.getByRole("button", { name: B.open.back })).toBeHidden();
  });

  test("cancels a long batch and leaves the page answering", async ({ page }) => {
    const panel = await open(page);
    await measureFrequency(panel, { seconds: "30" });
    await panel.getByRole("button", { name: B.run }).click();
    await expect(panel.getByTestId("builds-progress")).toBeVisible();
    // the page still paints while the worker builds: a frame comes within a second
    const frame = await page.evaluate(() => new Promise<number>((resolve) => { const t = performance.now(); requestAnimationFrame(() => resolve(performance.now() - t)); }));
    expect(frame).toBeLessThan(1000);
    await panel.getByRole("button", { name: B.cancel }).click();
    await expect(panel.getByText(/^Cancelled after \d+ builds\./)).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByRole("button", { name: B.run })).toBeEnabled();
  });
});
