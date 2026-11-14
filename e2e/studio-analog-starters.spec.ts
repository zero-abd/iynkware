import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import instruments from "../src/i18n/messages/en/instruments.json";
import studio from "../src/i18n/messages/en/studio.json";
import studioHome from "../src/i18n/messages/en/studioHome.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";

// The analog starters on the live solver, read the way a student reads them: a multimeter on the capacitor and on the
// amplifier output, a scope on the 555 output, and the flow lens drawing wire colour and current over the canvas.

const STARTERS = studioHome.starters;

async function start(page: Page, title: string): Promise<Locator> {
  await page.goto("/en/studio");
  await page.getByRole("list", { name: STARTERS.listLabel }).getByRole("button", { name: new RegExp(`^${title}`) }).click();
  await expect(page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true }).click();
  await page.getByRole("toolbar", { name: studioRun.bar.label }).getByRole("button", { name: studioRun.bar.run, exact: true }).click();
  await expect(page.getByText(studioRun.phase.running).first()).toBeVisible();
  return page.getByTestId("instrument-dock");
}

/** `point` is the label the point list shows: the part and the pin, a chip pin by its number. */
async function add(page: Page, dock: Locator, kind: string, point: string) {
  await dock.getByRole("button", { name: instruments.dock.add }).click();
  await page.getByRole("menuitem", { name: kind, exact: true }).click();
  await dock.getByRole("searchbox", { name: instruments.dock.searchPoints }).fill(point);
  await dock.locator("form").getByRole("combobox").selectOption({ label: point });
  await dock.locator("form").getByRole("button", { name: instruments.dock.add }).click();
}

const volts = async (reading: Locator) => {
  const m = /^(-?[\d.]+) V/.exec((await reading.innerText()).trim());
  return m ? Number(m[1]) : Number.NaN;
};

/** How many pixels of the flow canvas are painted. */
const painted = (page: Page) =>
  page.locator("canvas[data-flow-layer]").evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++;
    return n;
  });

/** Makes the browser report a device, so the lens default does not depend on the machine the test runs on. */
const device = (page: Page, cores: number, memoryGb: number) =>
  page.addInitScript(
    ([c, m]) => {
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => c });
      Object.defineProperty(navigator, "deviceMemory", { get: () => m });
    },
    [cores, memoryGb],
  );

test.describe("analog starters", () => {
  test("the RC charge: the capacitor climbs toward 5 V less the LED drop", async ({ page }) => {
    const dock = await start(page, STARTERS["rc-led"].title);
    await add(page, dock, instruments.kind.multimeter, "C1 +");
    const reading = dock.getByRole("status", { name: instruments.meter.reading });
    await expect.poll(() => volts(reading), { timeout: 20_000 }).toBeGreaterThan(1);
    await expect.poll(() => volts(reading), { timeout: 30_000 }).toBeGreaterThan(1.9);
    expect(await volts(reading)).toBeLessThan(3.1);
  });

  test("the op amp stage doubles the knob's 1 V", async ({ page }) => {
    const dock = await start(page, STARTERS["opamp-amplifier"].title);
    await add(page, dock, instruments.kind.multimeter, "U2 1");
    const reading = dock.getByRole("status", { name: instruments.meter.reading });
    await expect.poll(() => volts(reading), { timeout: 20_000 }).toBeGreaterThan(1.9);
    expect(await volts(reading)).toBeLessThan(2.1);
  });

  test("the 555 blinks at about one hertz, which a scope on its output measures", async ({ page }) => {
    const dock = await start(page, STARTERS["blinker-555"].title);
    await add(page, dock, instruments.kind.oscilloscope, "U2 3");
    const scope = dock.getByTestId("scope");
    await scope.getByLabel(instruments.scope.timePerDiv).selectOption("0.2");
    const frequency = scope.getByTestId("scope-freq-0");
    await expect.poll(async () => Number.parseFloat((await frequency.innerText()).replace(/[^\d.]/g, "")), { timeout: 30_000 }).toBeGreaterThan(0.9);
    expect(Number.parseFloat((await frequency.innerText()).replace(/[^\d.]/g, ""))).toBeLessThan(1.2);
  });

  test("the flow lens paints the wires of a running circuit and clears them when it is switched off", async ({ page }) => {
    await device(page, 8, 8);
    await start(page, STARTERS["rc-led"].title);
    const flow = page.getByRole("button", { name: studioRun.flow.toggle, exact: true });
    await expect(flow).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => painted(page), { timeout: 15_000 }).toBeGreaterThan(500);
    await expect(page.getByLabel(studioRun.flow.legend)).toBeVisible();
    await flow.click();
    await expect(flow).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => painted(page), { timeout: 5_000 }).toBe(0);
    await expect(page.getByLabel(studioRun.flow.legend)).toBeHidden();
  });

  test("with reduced motion the lens keeps its wire colours and draws still arrows, and it can be reached by keyboard", async ({ page }) => {
    await device(page, 8, 8);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await start(page, STARTERS["rc-led"].title);
    const flow = page.getByRole("button", { name: studioRun.flow.toggle, exact: true });
    await expect(flow).toHaveAttribute("aria-pressed", "true");
    await expect(flow).toHaveAccessibleDescription(studioRun.flow.hintStill);
    await expect.poll(() => painted(page), { timeout: 15_000 }).toBeGreaterThan(500);
    const still = await painted(page);
    await page.waitForTimeout(600);
    expect(Math.abs((await painted(page)) - still)).toBeLessThan(still * 0.2);
    await flow.focus();
    await page.keyboard.press("Enter");
    await expect(flow).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => painted(page), { timeout: 5_000 }).toBe(0);
  });

  test("on a low-end device the lens starts off, paints nothing, and stays on once the student turns it on", async ({ page }) => {
    await device(page, 2, 2);
    await start(page, STARTERS["rc-led"].title);
    const flow = page.getByRole("button", { name: studioRun.flow.toggle, exact: true });
    await expect(flow).toHaveAttribute("aria-pressed", "false");
    expect(await painted(page)).toBe(0);
    await flow.click();
    await expect.poll(() => painted(page), { timeout: 15_000 }).toBeGreaterThan(500);
    await page.reload();
    await expect(page.getByRole("button", { name: studioRun.flow.toggle, exact: true })).toHaveAttribute("aria-pressed", "true");
  });
});
