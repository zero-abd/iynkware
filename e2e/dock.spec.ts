import { expect, test } from "./support/no-egress";
import shell from "../src/i18n/messages/en/shell.json";
import { dockCopy, expectTabs, LAB_PAGES, openDock, watchErrors } from "./dock-shared";

for (const lab of LAB_PAGES) {
  test(`dock tabs open on the ${lab.name} page`, async ({ page }) => {
    const errors = watchErrors(page);
    const response = await page.goto(lab.path);
    expect(response?.status(), lab.path).toBe(200);
    const dock = await openDock(page, false);
    await expectTabs(dock);
    expect(errors).toEqual([]);
  });
}

test("Together is in the nav", async ({ page }) => {
  await page.goto("/en/boards/nano");
  await openDock(page, false);
  await expect(page.locator("header:visible").getByRole("link", { name: shell.nav.together })).toBeVisible();
});

test("a hidden tab event does not reveal Hardware", async ({ page }) => {
  await page.goto("/en/boards/nano");
  const dock = await openDock(page, false);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("iynk:dock-tab", { detail: { tab: "hardware" } }));
  });
  await expect(dock.getByRole("tab", { name: dockCopy.tabs.hardware })).toHaveCount(0);
});

for (const [w, h] of [[1440, 900], [1920, 1080]]) {
  test.describe(`on a ${w} px desk`, () => {
    test.use({ viewport: { width: w, height: h } });

    test("the open drawer pushes the page over: the rails give up room first, the stage keeps 24rem", async ({ page }) => {
      await page.goto("/en/boards/nano/blink");
      const width = (selector: string) => page.locator(`main:visible ${selector}`).first().evaluate((el) => el.getBoundingClientRect().width);
      const stage = await width(".lab-stage");
      const left = await width(".lab-left");
      const right = await width(".lab-right");
      await openDock(page, false);
      // The 416 px drawer pushes the page over. The guide and the inspector narrow (never below 12rem and 18rem)
      // and the stage stops at 24rem (384 px) however wide the screen is.
      await expect.poll(() => width(".lab-right")).toBeLessThan(right - 50);
      expect(await width(".lab-stage")).toBeGreaterThanOrEqual(384);
      expect(await width(".lab-stage")).toBeLessThan(stage);
      expect(await width(".lab-left")).toBeGreaterThanOrEqual(192);
      expect(await width(".lab-left")).toBeLessThan(left);
      expect(await width(".lab-right")).toBeGreaterThanOrEqual(288);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    });
  });
}
