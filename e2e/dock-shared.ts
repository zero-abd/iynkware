import { expect, type Locator, type Page } from "@playwright/test";
import common from "../src/i18n/messages/en/common.json";
import search from "../src/i18n/messages/en/search.json";

export const dockCopy = common.client.dock;

export const LAB_PAGES = [
  { name: "board", path: "/en/boards/nano" },
  { name: "lesson", path: "/en/boards/nano/blink" },
] as const;

export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat|did not match|Minified React error/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  return errors;
}

/**
 * Opens the dock from its "Lab tools" button in the page and returns it: the drawer on a desk, the sheet on a phone.
 * A room link opens it by itself, so the button is pressed only while the dock isn't showing (and again if a click
 * landed before hydration).
 */
export async function openDock(page: Page, phone: boolean): Promise<Locator> {
  const trigger = page.locator("main").getByRole("button", { name: dockCopy.open });
  await expect(trigger).toBeVisible();
  const dock = phone
    ? page.getByRole("dialog", { name: dockCopy.label })
    : page.locator('[data-testid="lab-dock"][data-ready="true"][data-layout="desk"]');
  await expect(async () => {
    if (!(await dock.isVisible())) await trigger.click({ timeout: 2_000 });
    await expect(dock).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  if (phone) await expect(dock.locator('[data-testid="lab-dock"][data-ready="true"]')).toHaveAttribute("data-layout", "phone");
  return dock;
}

export async function expectTabs(dock: Locator) {
  const real = dock.getByRole("tab", { name: dockCopy.tabs.real });
  await real.click();
  await expect(real).toHaveAttribute("aria-selected", "true");
  // The partner lives in Studio now, and Hardware stays hidden without its flag.
  for (const name of [dockCopy.tabs.partner, dockCopy.tabs.together, dockCopy.tabs.hardware]) {
    await expect(dock.getByRole("tab", { name })).toHaveCount(0);
  }
  await expect(dock.getByTestId("search-off").or(dock.getByTestId("not-set-up").last()).or(dock.getByRole("button", { name: search.real.check }))).toBeVisible();
}
