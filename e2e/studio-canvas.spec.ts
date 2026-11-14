import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import breadboard from "../src/parts/data/breadboard.component.json";
import uno from "../src/parts/data/uno-r3.component.json";
import studio from "../src/i18n/messages/en/studio.json";
import studioEdit from "../src/i18n/messages/en/studioEdit.json";
import studioHome from "../src/i18n/messages/en/studioHome.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";
import studioWire from "../src/i18n/messages/en/studioWire.json";

// The core loop of Studio with the mouse alone: an LED and a resistor go into the breadboard, two wires are drawn from
// the Uno, the sketch runs and the LED blinks. Where a pin or hole sits on the screen is read from the dots the canvas
// draws, which come in the order of the part's pins.

test.use({ viewport: { width: 1440, height: 900 } });

const PIN_DOT = 'circle[fill="var(--studio-pin)"]';
const holeNames = breadboard.pins.map((p) => p.id);
const unoPins = uno.pins.filter((p) => p.type !== "mechanical").map((p) => p.id);

const canvas = (page: Page) => page.getByRole("application", { name: studio.canvas.label });
const status = (page: Page) => page.getByRole("status").filter({ hasText: /\S/ });
const overlayText = (page: Page) => page.locator('[data-kind="overlay"] text');

async function centre(dot: Locator) {
  const box = await dot.boundingBox();
  if (!box) throw new Error("the pin dot is not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const hole = (page: Page, name: string) => centre(page.locator(`[data-kind="surface"] ${PIN_DOT}`).nth(holeNames.indexOf(name)));
const unoPin = (page: Page, name: string) => centre(page.locator(`g[data-kind="part"]:has(> title:text-is("U1")) ${PIN_DOT}`).nth(unoPins.indexOf(name)));

async function placeOnHole(page: Page, search: string, name: RegExp, at: string) {
  await page.getByRole("searchbox", { name: studioEdit.palette.search }).fill(search);
  await page.getByRole("button", { name }).first().click();
  const target = await hole(page, at);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function draw(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test.describe("Studio canvas", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/en/studio");
    await page.getByRole("button", { name: studio.newProject, exact: true }).click();
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-kind="surface"]')).toBeVisible();
  });

  test("builds an LED blink on an Uno with the mouse and the LED blinks", async ({ page }) => {
    await placeOnHole(page, "resistor", /^Resistor/, "b10");
    await expect(status(page).filter({ hasText: /^Placed R1\./ })).toBeVisible();
    await placeOnHole(page, "LED", /5 mm through-hole LED/, "c14");
    await expect(status(page).filter({ hasText: /^Placed D1\./ })).toBeVisible();

    await draw(page, await unoPin(page, "D13"), await hole(page, "a10"));
    await expect(status(page).filter({ hasText: /^Wire added from U1\.D13/ })).toBeVisible();
    await draw(page, await unoPin(page, "GND"), await hole(page, "a15"));
    await expect(status(page).filter({ hasText: /^Wire added from U1\.GND/ })).toBeVisible();

    await page.getByRole("toolbar", { name: studio.topBar.label }).getByRole("button", { name: studioRun.bar.run, exact: true }).click();
    const lit = overlayText(page).filter({ hasText: new RegExp(`^${studioRun.overlay.on}$`) });
    const dark = overlayText(page).filter({ hasText: new RegExp(`^${studioRun.overlay.off}$`) });
    await expect(lit).toHaveCount(1, { timeout: 30_000 });
    await expect(dark).toHaveCount(1, { timeout: 30_000 });
    await expect(lit).toHaveCount(1, { timeout: 30_000 });
  });

  test("selects a part by clicking it, turns a loose part with R and deletes it with Delete", async ({ page }) => {
    await page.getByRole("searchbox", { name: studioEdit.palette.search }).fill("LED");
    await page.getByRole("button", { name: /5 mm through-hole LED/ }).first().click();
    const box = (await canvas(page).boundingBox())!;
    // The Uno is drawn at its real size and fills the canvas from top to bottom, so the free canvas is the strip at its left.
    await page.mouse.click(box.x + box.width * 0.05, box.y + box.height / 2);
    await expect(status(page).filter({ hasText: /^Placed D1 on the canvas/ })).toBeVisible();

    await page.mouse.click(box.x + 12, box.y + 12);
    await expect(page.getByText(/^0 selected$/)).toBeVisible();
    const part = page.locator('g[data-kind="part"]:has(> title:text-is("D1"))');
    await part.click({ position: { x: 2, y: 2 }, force: true });
    await expect(page.getByText(/^1 selected$/)).toBeVisible();
    await page.keyboard.press("r");
    await expect(part).toHaveAttribute("transform", /rotate\(-270\)/);
    await page.keyboard.press("Delete");
    await expect(part).toHaveCount(0);
  });

  test("says why a wire was refused, where the person is looking", async ({ page }) => {
    const from = await unoPin(page, "D13");
    // D13 is on the top header, so the bare canvas is straight up, past the edge of the board.
    await draw(page, from, { x: from.x, y: from.y - 22 });
    await expect(status(page).filter({ hasText: studioWire.wire.refuse["empty-target"] })).toBeVisible();
  });

  test("shows the pin under the pointer", async ({ page }) => {
    const pin = await unoPin(page, "D13");
    await page.mouse.move(pin.x, pin.y);
    await expect(overlayText(page).filter({ hasText: "U1.D13" })).toBeVisible();
  });

  test("draws the Blink starter whole: the Uno, a breadboard of the right size, its parts in the holes and two wires", async ({ page }) => {
    await page.goto("/en/studio");
    await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${studioHome.starters.blink.title}`) }).click();
    const surface = page.locator('[data-kind="surface"]');
    await expect(surface).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('g[data-kind="part"]:has(> title:text-is("U1"))')).toHaveCount(1);
    await expect(page.locator('g[data-kind="wire"][data-id^="wir_"]')).toHaveCount(2);

    const board = (await surface.boundingBox())!;
    expect(board.width / board.height).toBeCloseTo(82.5 / 54.5, 1);
    const resistor = (await page.locator('g[data-kind="part"]:has(> title:text-is("RES1"))').boundingBox())!;
    expect(resistor.x).toBeGreaterThan(board.x);
    expect(resistor.y).toBeGreaterThan(board.y);
    expect(resistor.x + resistor.width).toBeLessThan(board.x + board.width);
  });

  test("fits the whole circuit in the canvas on open and when 0 is pressed", async ({ page }) => {
    await page.goto("/en/studio");
    await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${studioHome.starters.blink.title}`) }).click();
    await expect(page.locator('[data-kind="surface"]')).toBeVisible({ timeout: 15_000 });
    const inside = async () => {
      const frame = (await canvas(page).boundingBox())!;
      for (const item of [page.locator('[data-kind="surface"]'), page.locator('g[data-kind="part"]:has(> title:text-is("U1"))')]) {
        const box = (await item.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(frame.x);
        expect(box.y).toBeGreaterThanOrEqual(frame.y);
        expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width);
        expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height);
      }
    };
    await inside();

    const width = async () => (await page.locator('[data-kind="surface"]').boundingBox())!.width;
    const fitted = await width();
    await canvas(page).focus();
    await page.keyboard.press("+");
    await page.keyboard.press("+");
    await expect.poll(width).toBeGreaterThan(fitted * 1.3);
    await page.keyboard.press("0");
    await expect.poll(async () => Math.abs((await width()) - fitted)).toBeLessThan(1);
    await inside();
  });

  test("the schematic shows the parts and the board without the breadboard, and the Board tab opens", async ({ page }) => {
    await page.goto("/en/studio");
    await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${studioHome.starters.blink.title}`) }).click();
    await expect(page.locator('[data-kind="surface"]')).toBeVisible({ timeout: 15_000 });

    await page.getByRole("tab", { name: studio.views.tab.schematic }).click();
    await expect(page.locator('[data-kind="surface"]')).toHaveCount(0);
    for (const refdes of ["U1", "RES1", "LED1"]) await expect(page.locator(`g[data-kind="part"]:has(> title:text-is("${refdes}"))`)).toHaveCount(1);

    await page.getByRole("tab", { name: studio.views.tab.board, exact: true }).click();
    await expect(page.getByRole("tab", { name: studio.views.tab.board, exact: true })).toHaveAttribute("aria-selected", "true");
  });
});
