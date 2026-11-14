import type { Locator, Page } from "@playwright/test";
import { expect } from "./no-egress";
import breadboard from "../../src/parts/data/breadboard.component.json";
import uno from "../../src/parts/data/uno-r3.component.json";
import studio from "../../src/i18n/messages/en/studio.json";
import studioEdit from "../../src/i18n/messages/en/studioEdit.json";
import studioRun from "../../src/i18n/messages/en/studioRun.json";

// Building a circuit in the Studio the way a student does: parts from the palette, wires drawn between pins and holes.

const PIN_DOT = 'circle[fill="var(--studio-pin)"]';
const holeNames = breadboard.pins.map((p) => p.id);
const unoPins = uno.pins.filter((p) => p.type !== "mechanical").map((p) => p.id);

export const canvas = (page: Page) => page.getByRole("application", { name: studio.canvas.label });

async function centre(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("the element is not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export const hole = (page: Page, name: string) => centre(page.locator(`[data-kind="surface"] ${PIN_DOT}`).nth(holeNames.indexOf(name)));
export const unoPin = (page: Page, name: string) => centre(page.locator(`g[data-kind="part"]:has(> title:text-is("U1")) ${PIN_DOT}`).nth(unoPins.indexOf(name)));

export async function draw(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

/** Waits until the canvas stops moving, so a hole read now is where the pointer will find it. */
export async function stillCanvas(page: Page) {
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 2);
  let last = "";
  await expect(async () => {
    const now = JSON.stringify(await hole(page, "a1"));
    const steady = now === last;
    last = now;
    await page.waitForTimeout(200);
    expect(steady).toBe(true);
  }).toPass({ timeout: 10_000 });
}

export async function place(page: Page, search: string, name: RegExp, where: () => Promise<{ x: number; y: number }>) {
  await page.getByRole("searchbox", { name: studioEdit.palette.search }).fill(search);
  await page.getByRole("button", { name }).first().click();
  await expect(page.getByText(/ is ready\. Click or tap to place it/)).toBeVisible();
  await stillCanvas(page);
  const at = await where();
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
}

export async function newProject(page: Page) {
  await page.goto("/en/studio");
  await page.getByRole("button", { name: studio.newProject, exact: true }).click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-kind="surface"]')).toBeVisible();
  await stillCanvas(page);
}

export async function run(page: Page) {
  await page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true }).click();
  await page.getByRole("toolbar", { name: studioRun.bar.label }).getByRole("button", { name: studioRun.bar.run, exact: true }).click();
  await expect(page.getByText(studioRun.phase.running).first()).toBeVisible();
}
