import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/no-egress";
import { waitForAnimations } from "./support/settled";
import { LOCALES, htmlLang } from "../src/i18n/config";
import common from "../src/i18n/messages/en/common.json";
import commonDe from "../src/i18n/messages/de/common.json";
import { PAPER_DARK, PAPER_LIGHT } from "../src/lib/theme-colors";

async function seriousViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

test("an unknown page inside a language is a branded 404 with the site frame", async ({ page }) => {
  const response = await page.goto("/en/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Back to the dashboard" })).toHaveAttribute("href", "/en");
  await expect(page.getByRole("main").getByRole("button", { name: "Search the site" })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await waitForAnimations(page);
  expect(await seriousViolations(page)).toEqual([]);
});

test("the 404 search button opens the command menu", async ({ page }) => {
  await page.goto("/en/does-not-exist");
  await page.getByRole("main").getByRole("button", { name: "Search the site" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test.describe("an unknown page with no language", () => {
  test.use({ locale: "de-DE" });

  test("is the 404 of the browser's language, with the site frame and the address kept", async ({ page }) => {
    const response = await page.goto("/zzz");
    expect(response?.status()).toBe(404);
    expect(new URL(page.url()).pathname).toBe("/zzz");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByRole("heading", { level: 1, name: commonDe.notFound.title })).toBeVisible();
    await expect(page.getByRole("banner")).toBeVisible();
    for (const locale of LOCALES) await expect(page.getByRole("contentinfo").locator(`a[hreflang="${htmlLang(locale)}"]`)).toBeVisible();
    await waitForAnimations(page);
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("answers 404 for a deeper path and for a page that only exists under a language", async ({ request }) => {
    for (const path of ["/zzz/deeper", "/studio", "/privacy"]) expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  });
});

test("robots.txt points at the sitemap", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("Disallow: /api/");
  expect(body).toMatch(/Sitemap: https?:\/\/[^/\s]+\/sitemap\.xml/);
});

test("sitemap.xml lists pages with hreflang alternates", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("/en/privacy");
  expect(body).toContain('hreflang="x-default"');
});

test("the manifest parses and has an icon", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest.name).toBe(common.site.name);
  expect(manifest.icons.length).toBeGreaterThan(0);
});

test("the home head carries description, sharing tags and a theme color per scheme", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /\S/);
  for (const property of ["og:title", "og:description", "og:image"]) {
    await expect(page.locator(`meta[property="${property}"]`)).toHaveCount(1);
  }
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  await expect(page.locator('meta[name="theme-color"][media="(prefers-color-scheme: light)"]')).toHaveAttribute("content", PAPER_LIGHT);
  await expect(page.locator('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]')).toHaveAttribute("content", PAPER_DARK);
});

test("the skip link shows on the first Tab and moves focus to main", async ({ page }) => {
  await page.goto("/en");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: common.a11y.skipToContent });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main-en")).toBeFocused();
});
