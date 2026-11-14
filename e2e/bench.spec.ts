import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import instruments from "../src/i18n/messages/en/instruments.json";
import studio from "../src/i18n/messages/en/studio.json";
import studioHome from "../src/i18n/messages/en/studioHome.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";

// The bench instruments of the Studio: a function generator and a scope added on the Potentiometer example, the scope
// reading the frequency that was set, and a logic analyser with a decoder.

async function startKnob(page: Page): Promise<Locator> {
  await page.goto("/en/studio");
  await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${studioHome.starters.knob.title}`) }).click();
  await expect(page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true }).click();
  await page.getByRole("toolbar", { name: studioRun.bar.label }).getByRole("button", { name: studioRun.bar.run, exact: true }).click();
  await expect(page.getByText(studioRun.phase.running).first()).toBeVisible();
  return page.getByTestId("instrument-dock");
}

async function add(page: Page, dock: Locator, kind: string, point: string) {
  await dock.getByRole("button", { name: instruments.dock.add }).click();
  await page.getByRole("menuitem", { name: kind, exact: true }).click();
  await dock.getByRole("searchbox", { name: instruments.dock.searchPoints }).fill(point);
  await dock.locator("form").getByRole("combobox").selectOption({ index: 1 });
  await dock.locator("form").getByRole("button", { name: instruments.dock.add }).click();
}

test.describe("bench instruments", () => {
  test("a scope shows the frequency a function generator was set to", async ({ page }) => {
    const dock = await startKnob(page);
    await add(page, dock, instruments.kind.functionGenerator, "POT1 W");
    const generator = dock.getByTestId("function-generator");
    const frequency = generator.getByLabel(`${instruments.fgen.hz} (Hz)`);
    await frequency.fill("2k");
    await frequency.blur();
    await expect(frequency).toHaveValue("2kHz");

    await add(page, dock, instruments.kind.oscilloscope, "POT1 W");
    const scope = dock.getByTestId("scope");
    await expect(scope.getByLabel(instruments.scope.timePerDiv)).toBeVisible();
    await expect(scope.getByLabel(instruments.scope.mode)).toBeVisible();

    // The generator was added while the run was going without one, and the run takes it as it is: no restart.
    await expect(generator.getByRole("status")).toHaveText(instruments.bench.status.on, { timeout: 15_000 });
    await scope.getByLabel(instruments.scope.timePerDiv).selectOption("0.0005");
    await expect.poll(async () => Number.parseFloat((await scope.getByTestId("scope-freq-0").innerText()).replace("kHz", "e3")), { timeout: 15_000 }).toBeCloseTo(2000, -1);
  });

  test("a generator set above a tenth of the sample rate says its wave is drawn from few points, on the generator and on the scope", async ({ page }) => {
    const dock = await startKnob(page);
    await add(page, dock, instruments.kind.functionGenerator, "POT1 W");
    const generator = dock.getByTestId("function-generator");
    await expect(generator.getByTestId("fgen-rate")).toHaveText("Sample rate 100kHz");
    const frequency = generator.getByLabel(`${instruments.fgen.hz} (Hz)`);
    const fewPoints = generator.getByText(/^Above 10kHz the wave is drawn from few points/);
    await expect(fewPoints).toHaveCount(0);

    await add(page, dock, instruments.kind.oscilloscope, "POT1 W");
    const scope = dock.getByTestId("scope");
    await expect(scope.getByTestId("scope-few-points")).toHaveCount(0);

    await frequency.fill("50k");
    await frequency.blur();
    await expect(fewPoints).toBeVisible();
    await expect(scope.getByTestId("scope-few-points")).toContainText("A generator runs at 50kHz", { timeout: 15_000 });

    await frequency.fill("2k");
    await frequency.blur();
    await expect(fewPoints).toHaveCount(0);
    await expect(scope.getByTestId("scope-few-points")).toHaveCount(0);
  });

  test("a logic analyser offers the bus decoders and asks for the lines they need", async ({ page }) => {
    const dock = await startKnob(page);
    await add(page, dock, instruments.kind.logicAnalyser, "POT1 W");
    await dock.getByTestId("decoder-protocol").selectOption("i2c");
    await expect(dock.getByLabel(instruments.decode.pick.replace("{role}", "SCL"))).toBeVisible();
    await dock.getByTestId("decoder-protocol").selectOption("uart");
    await expect(dock.getByLabel(instruments.decode.baud)).toHaveValue("9600");
    await dock.getByTestId("decoder-protocol").selectOption("spi");
    await expect(dock.getByLabel(instruments.decode.spiMode)).toBeVisible();
    await expect(dock.getByLabel(instruments.decode.pick.replace("{role}", "MOSI"))).toBeVisible();
  });
});
