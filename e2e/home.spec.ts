import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/no-egress";
import { waitForAnimations } from "./support/settled";
import { LOCALES } from "../src/i18n/config";
import home from "../src/i18n/messages/en/home.json";

const BANNED = /sign up|pricing|price|sponsor|visitors|users online/i;

test("the home page says what iynk is and what it does not do", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByText(home.hero.lede)).toBeVisible();
  const section = page.getByRole("region", { name: home.open.title });
  // the repository is private until the public release, so the one link is the site's own guide
  await expect(section.getByRole("link", { name: home.open.selfHost })).toHaveAttribute("href", "/en/self-hosting");
  await expect(section.locator('a[href*="github.com"]')).toHaveCount(0);
  await expect(page.getByText(home.proof.fidelity)).toBeVisible();
  await expect(page.getByRole("heading", { name: home.labs.heading })).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(BANNED);
});

test("the home page has its sections in order and one primary action above the fold", async ({ page }) => {
  await page.goto("/en");
  const titles = [home.labs.heading, home.benefits.title, home.how.title, home.proof.title, home.faq.title, home.open.title, home.end.title];
  // polled, not read once: a slow runner can still be laying the page out when goto returns
  await expect
    .poll(async () => (await page.locator("main h1, main h2").allInnerTexts()).map((text) => text.trim()).filter((text) => titles.includes(text)))
    .toEqual(titles);
  await expect(page.getByRole("link", { name: home.hero.cta }).first()).toBeInViewport();
  await expect(page.locator("main").getByRole("link", { name: home.hero.cta })).toHaveCount(2);
  await expect(page.getByRole("link", { name: home.hero.cta }).first()).toHaveAttribute("href", "/en/boards/uno-r3/blink?try=1");
  await expect(page).toHaveTitle(home.meta.title);
});

test("the glyph scene is a labelled picture and its time slider moves through the day", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("img", { name: home.scene.alt })).toBeVisible();
  const slider = page.getByRole("slider", { name: home.scene.time });
  await expect(slider).toHaveAttribute("aria-valuetext", home.scene.dusk);
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuetext", home.scene.dawn);
  await page.keyboard.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", home.scene.night);
});

test("the floating controls change the theme and the reading font", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: home.controls.dark }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: home.controls.light }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByLabel(home.controls.font).selectOption("serif");
  await expect(page.locator("html")).toHaveAttribute("data-font", "serif");
});

test("the questions are also published as FAQPage data", async ({ page }) => {
  await page.goto("/en");
  const json = await page.locator('script[type="application/ld+json"]').first().textContent();
  const data = JSON.parse(json ?? "{}");
  expect(data["@type"]).toBe("FAQPage");
  expect(data.mainEntity).toHaveLength(8);
  expect(data.mainEntity[0].name).toBe(home.faq["1"].q);
});

for (const lang of LOCALES) {
  test(`the ${lang} home page opens without a page error`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/${lang}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("main h2")).toHaveCount(7);
    expect(errors).toEqual([]);
  });
}

test("the home page passes axe and fits a 360 px screen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await waitForAnimations(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the home page still draws, without a page error, when its fonts fail to download", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/\.(woff2?|ttf)(\?|$)/, (route) => route.abort());
  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});
