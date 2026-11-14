import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import { writeIynk } from "../src/export/iynk";
import type { Project } from "../src/project/generated/types";
import pico from "../src/studio/starters/pico.project.json";
import fidelity from "../src/i18n/messages/en/fidelity.json";
import studio from "../src/i18n/messages/en/studio.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";

// A Pico runs a UF2 file on rp2040js in the Studio. The fixtures are Thumb programs built by
// scripts/gen-rp2040-fixtures.mjs: one waits on the timer, one sleeps on WFI, one reads the ADC and prints.

const FIXTURES = join(process.cwd(), "src/sim/mcu/rp2040/fixtures");
const PROJECT = "Pico firmware";

async function openPico(page: Page, outputPath: (name: string) => string): Promise<void> {
  const project = { ...(structuredClone(pico) as unknown as Project), id: "prj_pico_uf2" };
  project.meta = { ...project.meta, title: PROJECT };
  const file = outputPath("pico.iynk");
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, writeIynk(project));
  await page.goto("/en/studio");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: studio.openFromFile }).click();
  await (await chooser).setFiles(file);
  await page.getByRole("button", { name: studio.row.open.replace("{name}", PROJECT), exact: true }).click();
  await expect(page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true }).click();
}

const bar = (page: Page) => page.getByRole("toolbar", { name: studioRun.bar.label });
const firmwareMode = (page: Page) => page.getByRole("radiogroup", { name: fidelity.firmware.mode }).getByRole("radio", { name: fidelity.firmware.firmware });
const lit = (page: Page) => page.locator("svg text").filter({ hasText: new RegExp(`^${studioRun.overlay.on}$`) });

async function run(page: Page): Promise<void> {
  await bar(page).getByRole("button", { name: studioRun.bar.run, exact: true }).click();
  await expect(bar(page).getByRole("status").filter({ hasText: studioRun.phase.running })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Forces the file input, which a test can fill, in place of the browser's picker.
  await page.addInitScript(() => void ((window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker = undefined));
});

test.describe("a Pico running a UF2 file", () => {
  test("blinks the LED on GP15 from a file imported on the run bar", async ({ page }, info) => {
    await openPico(page, (name) => info.outputPath(name));
    await firmwareMode(page).click();
    await page.getByLabel(fidelity.firmware.importUf2).setInputFiles(join(FIXTURES, "blink-poll.uf2"));
    await expect(page.getByText(/Loaded [\d,]+ bytes of firmware/)).toBeVisible();
    await run(page);
    // The pin changes every 250 ms, so both states show within a couple of seconds.
    await expect(lit(page).first()).toBeVisible({ timeout: 10_000 });
    await expect(lit(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(lit(page).first()).toBeVisible({ timeout: 10_000 });
  });

  test("takes a .uf2 file dropped on the Studio and shows what the firmware prints", async ({ page }, info) => {
    await openPico(page, (name) => info.outputPath(name));
    const bytes = [...readFileSync(join(FIXTURES, "say-hi.uf2"))];
    await page.evaluate((data) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(data)], "say-hi.uf2"));
      window.dispatchEvent(new DragEvent("dragover", { dataTransfer: transfer, cancelable: true }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, cancelable: true }));
    }, bytes);
    await expect(firmwareMode(page)).toHaveAttribute("aria-checked", "true");
    await run(page);
    await expect(page.getByRole("log").first()).toContainText("hi", { timeout: 15_000 });
  });

  test("says why a file that is not for the RP2040 cannot run", async ({ page }, info) => {
    await openPico(page, (name) => info.outputPath(name));
    await firmwareMode(page).click();
    const notUf2 = info.outputPath("not-a.uf2");
    writeFileSync(notUf2, new Uint8Array(512));
    await page.getByLabel(fidelity.firmware.importUf2).setInputFiles(notUf2);
    await expect(page.getByText(fidelity.import.error["uf2-bad-block"])).toBeVisible();
  });
});
