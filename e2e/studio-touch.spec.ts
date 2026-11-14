import type { CDPSession, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import breadboard from "../src/parts/data/breadboard.component.json";
import uno from "../src/parts/data/uno-r3.component.json";
import studio from "../src/i18n/messages/en/studio.json";
import fidelity from "../src/i18n/messages/en/fidelity.json";
import studioEdit from "../src/i18n/messages/en/studioEdit.json";
import studioHome from "../src/i18n/messages/en/studioHome.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";

// A student on a phone builds the Blink circuit from an empty project with a finger alone: parts come from the drawer,
// the canvas zooms on the first tap, wires are two taps, and the touch bar turns and deletes. Where a pin or hole is on
// the screen is read from the dots the canvas draws.

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const PIN_DOT = 'circle[fill="var(--studio-pin)"]';
const holeNames = breadboard.pins.map((p) => p.id);
const unoPins = uno.pins.filter((p) => p.type !== "mechanical").map((p) => p.id);

const canvas = (page: Page) => page.getByRole("application", { name: studio.canvas.label });
const status = (page: Page) => page.getByRole("status").filter({ hasText: /\S/ });
const overlayText = (page: Page) => page.locator('[data-kind="overlay"] text');
const bar = (page: Page) => page.getByRole("toolbar", { name: studio.canvas.touch.label });

async function centre(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("the element is not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const hole = (page: Page, name: string) => centre(page.locator(`[data-kind="surface"] ${PIN_DOT}`).nth(holeNames.indexOf(name)));
const unoPin = (page: Page, name: string) => centre(page.locator(`g[data-kind="part"]:has(> title:text-is("U1")) ${PIN_DOT}`).nth(unoPins.indexOf(name)));

/** One finger down, along a line and up, as the touch screen sends it. */
async function drag(cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }) {
  const at = (p: { x: number; y: number }) => [{ x: p.x, y: p.y }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(from) });
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at({ x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 }) });
  // A finger that puts a part down stops before it lifts; one that lifts while still moving flings, and Chrome takes the
  // next tap as the end of the fling, not a click.
  await new Promise((done) => setTimeout(done, 150));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(to) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Waits until the canvas stops moving, so a hole read now is where a finger will find it. */
async function stillCanvas(page: Page) {
  let last = "";
  await expect(async () => {
    const now = JSON.stringify(await hole(page, "a1"));
    const steady = now === last;
    last = now;
    await page.waitForTimeout(200);
    expect(steady).toBe(true);
  }).toPass({ timeout: 10_000 });
}

async function newProject(page: Page) {
  await page.goto("/en/studio");
  await page.getByRole("button", { name: studio.newProject, exact: true }).tap();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-kind="surface"]')).toBeVisible();
  await stillCanvas(page);
}

/**
 * Picks the part in the drawer, which puts itself away, and taps the canvas where a hole is. Zoomed out, the first tap
 * zooms in on the spot and the next one places; at working scale the first tap places.
 */
async function place(page: Page, search: string, name: RegExp, at: string) {
  await page.getByRole("button", { name: studio.layout.open.replace("{name}", studio.layout.regions.left) }).tap();
  await page.getByRole("searchbox", { name: studioEdit.palette.search }).fill(search);
  await page.getByRole("button", { name }).first().tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(status(page).filter({ hasText: / is ready\. Tap the canvas/ })).toBeVisible();
  const first = await hole(page, at);
  await page.touchscreen.tap(first.x, first.y);
  await expect(status(page).filter({ hasText: /^Zoomed in\. Tap again to place it\.$|^Placed / })).toBeVisible();
  await stillCanvas(page);
  if (await status(page).filter({ hasText: /^Placed / }).count()) return;
  const second = await hole(page, at);
  await page.touchscreen.tap(second.x, second.y);
}

test.describe("Studio on a phone", () => {
  test("builds the Blink circuit from an empty project with taps and runs it", async ({ page }) => {
    await newProject(page);
    await place(page, "resistor", /^Resistor/, "b10");
    await expect(status(page).filter({ hasText: /^Placed R1\./ })).toBeVisible();
    await place(page, "LED", /5 mm through-hole LED/, "c14");
    await expect(status(page).filter({ hasText: /^Placed D1\./ })).toBeVisible();

    await bar(page).getByRole("button", { name: studio.canvas.touch.fit }).tap();
    await stillCanvas(page);
    for (const [pin, to] of [["D13", "a10"], ["GND", "a15"]] as const) {
      const from = await unoPin(page, pin);
      await page.touchscreen.tap(from.x, from.y);
      const target = await hole(page, to);
      await page.touchscreen.tap(target.x, target.y);
      await expect(status(page).filter({ hasText: new RegExp(`^Wire added from U1\\.${pin}`) })).toBeVisible();
    }

    await page.getByRole("toolbar", { name: studio.topBar.label }).getByRole("button", { name: studioRun.bar.run, exact: true }).tap();
    const lit = overlayText(page).filter({ hasText: new RegExp(`^${studioRun.overlay.on}$`) });
    const dark = overlayText(page).filter({ hasText: new RegExp(`^${studioRun.overlay.off}$`) });
    await expect(lit).toHaveCount(1, { timeout: 30_000 });
    await expect(dark).toHaveCount(1, { timeout: 30_000 });
  });

  test("selects a placed part by touching its body, moves it with a drag and deletes it from the touch bar", async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await newProject(page);
    await place(page, "resistor", /^Resistor/, "b10");
    await expect(status(page).filter({ hasText: /^Placed R1\./ })).toBeVisible();
    const part = page.locator('g[data-kind="part"]:has(> title:text-is("R1"))');
    const frame = (await canvas(page).boundingBox())!;
    await page.touchscreen.tap(frame.x + 10, frame.y + 10);
    await expect(page.getByText(/^0 selected$/)).toBeVisible();

    const box = (await part.boundingBox())!;
    const body = { x: box.x + box.width / 2, y: box.y + box.height * 0.7 };
    await page.touchscreen.tap(body.x, body.y);
    await expect(page.getByText(/^1 selected$/)).toBeVisible();

    const before = await part.getAttribute("transform");
    const pitch = (await hole(page, "b11")).x - (await hole(page, "b10")).x;
    await drag(cdp, body, { x: body.x + pitch * 4, y: body.y });
    await expect(part).not.toHaveAttribute("transform", before!);
    await expect(page.getByText(/^1 selected$/)).toBeVisible();

    await bar(page).getByRole("button", { name: studio.canvas.touch.delete }).tap();
    await expect(part).toHaveCount(0);
  });

  test("pans the canvas with one finger over empty ground and keeps the zoom", async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await newProject(page);
    const box = (await canvas(page).boundingBox())!;
    const before = await hole(page, "a1");
    const pitch = (await hole(page, "a2")).x - before.x;
    await drag(cdp, { x: box.x + 20, y: box.y + 40 }, { x: box.x + 60, y: box.y + 40 });
    await expect(async () => {
      const now = await hole(page, "a1");
      expect(Math.abs(now.x - before.x - 40)).toBeLessThan(2);
      expect(Math.abs((await hole(page, "a2")).x - now.x - pitch)).toBeLessThan(0.1);
    }).toPass();
  });

  for (const { title } of [studioHome.starters["rc-led"], studioHome.starters["blinker-555"], studioHome.starters["opamp-amplifier"], studioHome.starters.rectifier, studioHome.starters["zener-regulator"]]) {
    test(`the ${title} starter runs for three seconds on a phone with no console error, no sideways scroll and every debug button on screen`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto("/en/studio");
      await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${title}`) }).tap();
      await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
      await page.getByRole("toolbar", { name: studio.topBar.label }).getByRole("button", { name: studioRun.bar.run, exact: true }).tap();
      await expect(page.getByText(studioRun.phase.running).first()).toBeVisible();
      await page.waitForTimeout(3000);

      const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
      expect(scroll).toBe(width);
      for (const button of await page.getByRole("region", { name: fidelity.debug.toggle }).getByRole("button").all()) {
        const box = (await button.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      expect(errors).toEqual([]);
    });
  }
});
