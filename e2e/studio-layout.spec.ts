import type { Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import studio from "../src/i18n/messages/en/studio.json";
import studioHome from "../src/i18n/messages/en/studioHome.json";

// Inside a project the editor takes the screen: no Projects title above it, the page never scrolls past its own
// regions, the dock resizes, and a phone keeps a canvas it can use. Export as .ino asks once.

const REGIONS = studio.layout.regions;

async function openBlink(page: Page) {
  await page.goto("/en/studio");
  await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${studioHome.starters.blink.title}`) }).click();
  await expect(page.getByRole("application", { name: studio.canvas.label })).toBeFocused({ timeout: 15_000 });
}

const box = async (page: Page, name: string) => (await page.getByRole("region", { name }).boundingBox())!;

test.describe("on a desktop screen", () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test("the editor fills the window under the project name", async ({ page }) => {
    await openBlink(page);
    const name = await page.getByRole("textbox", { name: studio.topBar.name }).inputValue();
    expect(name).toMatch(/^Blink/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page).toHaveTitle(`${name} | iynk`);
    await expect(page.getByRole("heading", { name: studio.title })).toHaveCount(0);

    const canvas = await box(page, REGIONS.canvas);
    const dock = await box(page, REGIONS.dock);
    expect(canvas.y).toBeLessThan(200);
    expect(canvas.height).toBeGreaterThan(400);
    expect(dock.height).toBeGreaterThanOrEqual(300);
    // The editor is the whole window: the site header waits above the top edge, the footer is left out, nothing scrolls.
    await expect.poll(() => page.evaluate(() => document.querySelector("body > header")!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(8);
    const edges = await page.evaluate(() => ({
      main: document.querySelector("body > main")!.getBoundingClientRect(),
      footer: getComputedStyle(document.querySelector("body > footer")!).display,
      page: document.documentElement.scrollHeight,
      window: innerHeight,
    }));
    expect(edges.main.top).toBe(0);
    expect(edges.main.bottom).toBeLessThanOrEqual(edges.window + 1);
    expect(edges.footer).toBe("none");
    expect(edges.page).toBeLessThanOrEqual(edges.window);
  });

  test("the site header slides in when the pointer reaches the top edge, and leaves again", async ({ page }) => {
    await openBlink(page);
    const header = page.locator("body > header");
    await page.mouse.move(800, 1);
    await expect.poll(async () => (await header.boundingBox())!.y).toBe(0);
    await page.mouse.move(800, 500);
    await expect.poll(async () => (await header.boundingBox())!.y).toBeLessThan(-40);
  });

  test("the dock follows the separator and stays inside the window", async ({ page }) => {
    await openBlink(page);
    const separator = page.getByRole("separator", { name: studio.layout.separator });
    const before = (await box(page, REGIONS.dock)).height;
    await separator.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("PageDown");
    expect((await box(page, REGIONS.dock)).height).toBeLessThan(before - 200);
    for (let i = 0; i < 30; i++) await page.keyboard.press("PageUp");
    const grown = await box(page, REGIONS.dock);
    const canvas = await box(page, REGIONS.canvas);
    expect(grown.height).toBeGreaterThan(before);
    expect(canvas.height).toBeGreaterThan(100);
  });

  test("Export as .ino asks once", async ({ page }) => {
    await openBlink(page);
    await page.getByRole("button", { name: studio.projectMenu.label }).click();
    await page.getByRole("menuitem", { name: studio.ino.export }).click();
    const dialog = page.getByRole("dialog", { name: studio.ino.export });
    await expect(dialog).toBeVisible();
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: studio.ino.export }).click();
    expect((await download).suggestedFilename()).toMatch(/\.zip$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the canvas keeps its room and the project runs", async ({ page }) => {
    await openBlink(page);
    await expect(page.getByText("Phone layout comes later")).toHaveCount(0);
    const canvas = await box(page, REGIONS.canvas);
    expect(canvas.height).toBeGreaterThan(300);
    expect(canvas.width).toBeGreaterThan(340);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

    const bar = page.getByRole("toolbar", { name: studio.topBar.label });
    await bar.getByRole("button", { name: studio.topBar.run }).click();
    await expect(bar.getByRole("button", { name: studio.topBar.stop })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: studio.layout.open.replace("{name}", REGIONS.left) }).click();
    await expect(page.getByRole("dialog", { name: REGIONS.left })).toBeVisible();
  });
});
