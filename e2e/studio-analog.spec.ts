import { expect, test } from "./support/no-egress";
import instruments from "../src/i18n/messages/en/instruments.json";
import studio from "../src/i18n/messages/en/studio.json";
import studioHome from "../src/i18n/messages/en/studioHome.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";

// The live circuit solver in a run: an Uno pin drives an LED through a resistor, and a multimeter in amps mode reads the
// current the solver finds, which is the pin's 5 V less the LED's 2 V over the resistor and the pin's own resistance.

test("a multimeter reads the LED current of an Uno pin through a 220 ohm resistor", async ({ page }) => {
  await page.goto("/en/studio");
  await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${studioHome.starters.blink.title}`) }).click();
  await expect(page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true }).click();
  await page.getByRole("toolbar", { name: studioRun.bar.label }).getByRole("button", { name: studioRun.bar.run, exact: true }).click();
  await expect(page.getByText(studioRun.phase.running).first()).toBeVisible();

  const dock = page.getByTestId("instrument-dock");
  await dock.getByRole("button", { name: instruments.dock.add }).click();
  await page.getByRole("menuitem", { name: instruments.kind.multimeter }).click();
  await dock.getByRole("searchbox", { name: instruments.dock.searchPoints }).fill("LED1");
  const points = dock.getByRole("combobox", { name: new RegExp(instruments.dock.pickPoint) });
  await points.selectOption({ index: 1 });
  await dock.locator("form").getByRole("button", { name: instruments.dock.add }).click();
  await dock.getByRole("radio", { name: instruments.meter.mode.dcAmps }).click();

  const reading = dock.getByRole("status", { name: instruments.meter.reading });
  const milliamps = async () => {
    const m = /^(-?[\d.]+) (m?)A/.exec((await reading.innerText()).trim());
    return m ? Math.abs(Number(m[1])) * (m[2] === "m" ? 1 : 1000) : 0;
  };
  // Blink holds the LED on for half of each second; intervals that are not a multiple of that keep the reads from locking onto the off half.
  await expect.poll(milliamps, { timeout: 20_000, intervals: [100, 250, 370] }).toBeGreaterThan(11);
  expect(await milliamps()).toBeLessThan(13.5);
  expect((await reading.innerText()).trim()).toMatch(/^-?\d+\.?\d* mA/);
});
