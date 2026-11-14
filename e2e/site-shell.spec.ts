import { expect, test } from "./support/no-egress";
import shell from "../src/i18n/messages/en/shell.json";
import together from "../src/i18n/messages/en/together.json";

test("the 404 page fetches nothing that answers 404 besides itself", async ({ page }) => {
  const failed: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400 && response.request().resourceType() !== "document") failed.push(`${response.status()} ${response.url()}`);
  });
  const response = await page.goto("/en/nope");
  expect(response?.status()).toBe(404);
  await page.waitForLoadState("networkidle");
  expect(failed).toEqual([]);
});

test("an unknown path with no language answers 404", async ({ request }) => {
  for (const path of ["/nope", "/xx", "/nope/deeper"]) expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
});

test.describe("the phone menu", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("closes by the cross in the corner, which is on the screen", async ({ page }) => {
    await page.goto("/en");
    await page.getByRole("button", { name: shell.nav.menu, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: shell.nav.menu });
    const cross = dialog.getByRole("button", { name: shell.nav.closeMenu });
    await expect(cross).toBeVisible();
    const box = (await cross.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.mouse.click(362, 30);
    await expect(dialog).toBeHidden();
  });
});

test.describe("the command menu", () => {
  async function search(page: import("@playwright/test").Page, query: string) {
    await page.goto("/en");
    const box = page.getByRole("combobox", { name: shell.command.title });
    // The shortcut does nothing until the page has hydrated, so press it again until the menu is there.
    await expect(async () => {
      if (!(await box.isVisible())) await page.keyboard.press("ControlOrMeta+k");
      await expect(box).toBeVisible({ timeout: 1000 });
    }).toPass();
    await box.fill(query);
    return page.getByRole("option");
  }

  test("finds a board, a lesson, a robotics bench, a drone and a Studio example", async ({ page }) => {
    const found: [string, string, string][] = [
      ["uno", shell.command.groups.boards, "Arduino Uno R3"],
      ["servo", shell.command.groups.lessons, "Servo"],
      ["l298n", shell.command.groups.robotics, "L298N"],
      ["quad", shell.command.groups.drones, "quad"],
      ["reaction", shell.command.groups.studio, "Reaction timer"],
    ];
    for (const [query, group, name] of found) {
      const options = await search(page, query);
      await expect(page.getByRole("group", { name: group })).toBeVisible();
      await expect(options.filter({ hasText: new RegExp(name, "i") }).first()).toBeVisible();
    }
  });

  test("opens a lesson page from a result", async ({ page }) => {
    const options = await search(page, "servo");
    await page.getByRole("group", { name: shell.command.groups.lessons }).getByRole("option").first().click();
    await expect(page).toHaveURL(/\/en\/boards\/[a-z0-9-]+\/servo$/);
    await expect(options.first()).toBeHidden();
  });
});

test.describe("the Together page", () => {
  test("says rooms run on your own copy, with the guide on this site, when no server is set", async ({ page }) => {
    await page.route("**/config.json", (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/en/together");
    const rooms = page.getByRole("region", { name: together.rooms.title });
    await expect(rooms.getByText(together.rooms.selfHost.title)).toBeVisible();
    await rooms.getByRole("link", { name: together.rooms.selfHost.guide }).click();
    await expect(page).toHaveURL(/\/en\/self-hosting$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("offline", () => {
  test("a page never opened shows the offline page, and one that was opened still loads", async ({ page, context }) => {
    await page.goto("/en");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await page.goto("/en/about");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const about = await page.getByRole("heading", { level: 1 }).innerText();

    await context.setOffline(true);
    await page.goto("/en/about");
    await expect(page.getByRole("heading", { level: 1, name: about })).toBeVisible();

    await page.goto("/en/boards");
    await expect(page).toHaveURL(/\/en\/offline$/);
    await expect(page.getByRole("heading", { level: 1, name: shell.offline.title })).toBeVisible();
    await context.setOffline(false);
  });
});
