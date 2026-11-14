import { writeFileSync } from "node:fs";
import { expect, test } from "./support/no-egress";
import fidelity from "../src/i18n/messages/en/fidelity.json";
import studio from "../src/i18n/messages/en/studio.json";
import studioHome from "../src/i18n/messages/en/studioHome.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";

// An Uno in Firmware mode runs an imported .hex on avr8js, fetched from /engines the first time.
// The program is three AVR words: sbi DDRB,5; sbi PORTB,5; rjmp to itself. Pin 13 goes high and stays high.
const PIN13_ON = ":06000000259A2D9AFFCFA6\n:00000001FF\n";

test("an Uno runs an imported .hex on avr8js and lights the LED on pin 13", async ({ page }, info) => {
  await page.addInitScript(() => void ((window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker = undefined));
  const hex = info.outputPath("pin13.hex");
  writeFileSync(hex, PIN13_ON);
  await page.goto("/en/studio");
  await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: /^Blink / }).click();
  await page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true }).click();
  await page.getByRole("radiogroup", { name: fidelity.firmware.mode }).getByRole("radio", { name: fidelity.firmware.firmware }).click();
  await page.getByLabel(fidelity.firmware.importHex).setInputFiles(hex);
  await expect(page.getByText(/Loaded [\d,]+ bytes of firmware/)).toBeVisible();

  const bar = page.getByRole("toolbar", { name: studioRun.bar.label });
  await bar.getByRole("button", { name: studioRun.bar.run, exact: true }).click();
  await expect(bar.getByRole("status").filter({ hasText: studioRun.phase.running })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("svg text").filter({ hasText: new RegExp(`^${studioRun.overlay.on}$`) }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(studioRun.phase.error)).toHaveCount(0);
});
