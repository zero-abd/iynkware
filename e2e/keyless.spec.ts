import type { Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import boardlab from "../src/i18n/messages/en/boardlab.json";
import common from "../src/i18n/messages/en/common.json";
import shell from "../src/i18n/messages/en/shell.json";
import studio from "../src/i18n/messages/en/studio.json";
import studioHome from "../src/i18n/messages/en/studioHome.json";
import { dockCopy, openDock } from "./dock-shared";

const PAGES = [
  "/en",
  "/en/boards",
  "/en/boards/uno-r3/blink",
  "/en/robotics/uno-r3-build",
  "/en/drones/quad5",
  "/en/drones/quad5/fly",
  "/en/about",
  "/en/together",
  "/de",
];

// The web build under test is told about the e2e server (playwright.config.ts); these visitors have none.
async function withoutServer(page: Page) {
  await page.route("**/config.json", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), server: null } });
  });
}

// Everything a visitor with no keys and no server could trip over, with the URL that did it.
function watchTrouble(page: Page) {
  const trouble: string[] = [];
  page.on("pageerror", (error) => trouble.push(`page error: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") trouble.push(`failed: ${request.url()} (${request.failure()?.errorText})`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) trouble.push(`${response.status()}: ${response.url()}`);
  });
  return trouble;
}

test("a visitor with no keys and no server walks the app without a single failure", async ({ page }) => {
  await withoutServer(page);
  const trouble = watchTrouble(page);

  for (const path of PAGES) {
    const before = trouble.length;
    await page.goto(path);
    await expect(page.locator("main").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(trouble.slice(before), path).toEqual([]);
  }

  await page.goto("/en/boards/uno-r3/blink");
  const main = page.locator("main#main-en");
  await expect(main.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await main.getByTestId("run-button").click();
  await expect(main.getByTestId("serial-lines")).toContainText(boardlab.serial.upload.done, { timeout: 10_000 });

  const dock = await openDock(page, false);
  await dock.getByRole("tab", { name: dockCopy.tabs.real }).click();
  await expect(dock.getByTestId("search-off")).toBeVisible();

  expect(trouble).toEqual([]);
});

test("with no server configured, Settings says the server is needed and nothing fails", async ({ page }) => {
  await withoutServer(page);
  const trouble = watchTrouble(page);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  for (const path of ["/en", "/en/together"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: shell.settings.label }).click();
    const panel = page.getByRole("dialog", { name: shell.settings.label });
    await expect(panel.getByText(common.client.server.status.off)).toBeVisible();
    await expect(panel.getByRole("link", { name: common.client.server.guide })).toBeVisible();
    await page.keyboard.press("Escape");
  }

  expect(trouble).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("a closed server port is shown as unreachable with the origins hint and nothing throws", async ({ page }) => {
  const trouble: string[] = [];
  page.on("pageerror", (error) => trouble.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("ERR_CONNECTION_REFUSED")) trouble.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => console.error(`csp: ${event.blockedURI}`));
  });

  await page.goto("/en/together");
  await page.getByRole("button", { name: shell.settings.label }).click();
  const panel = page.getByRole("dialog", { name: shell.settings.label });
  await panel.getByLabel(common.client.server.address).fill(`http://localhost:${process.env.E2E_DEAD_PORT}`);
  await panel.getByRole("button", { name: common.client.keys.save }).click();

  await expect(panel.getByText(common.client.server.status.unreachable)).toBeVisible();
  await expect(panel.getByText(common.client.server.status.unreachableHint)).toBeVisible();
  expect(trouble).toEqual([]);
});

test("with no server, a Studio project shares as a link that carries it, and the link opens read only", async ({ page, context }) => {
  await withoutServer(page);
  const trouble = watchTrouble(page);
  await page.goto("/en/studio");
  await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${studioHome.starters.blink.title}`) }).click();
  await expect(page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: studio.projectMenu.label }).click();
  await page.getByRole("menuitem", { name: studio.projectMenu.share }).click();
  const dialog = page.getByRole("dialog", { name: studio.rooms.share.title });
  await expect(dialog.getByText(studio.rooms.share.linkCarries)).toBeVisible();
  await dialog.getByRole("button", { name: studio.rooms.share.create }).click();
  // the starter holds one text item nobody has reviewed, so the dialog asks first, as a server share does
  await expect(dialog.getByRole("button", { name: studio.dialog.cancel })).toBeVisible();
  await dialog.getByRole("button", { name: studio.rooms.share.create }).click();
  const link = await dialog.getByRole("textbox", { name: studio.rooms.share.copy }).inputValue();
  expect(link).toMatch(/\/en\/studio#project=[A-Za-z0-9_-]+$/);

  const reader = await context.newPage();
  await withoutServer(reader);
  await reader.goto(link);
  await expect(reader.getByText(studio.rooms.banner.readOnlyShare)).toBeVisible({ timeout: 15_000 });
  await expect(reader).toHaveURL(/#share-open$/);
  await reader.getByRole("button", { name: studio.rooms.share.makeCopy }).first().click();
  await expect(reader).toHaveURL(/#\/prj_/, { timeout: 15_000 });
  expect(trouble).toEqual([]);
});
