import type { Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import ai from "../src/i18n/messages/en/ai.json";
import instruments from "../src/i18n/messages/en/instruments.json";
import studio from "../src/i18n/messages/en/studio.json";
import studioHome from "../src/i18n/messages/en/studioHome.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";

// The run controls and instruments of the Studio, driven the way a person does it: a steady knob, a Step that moves
// the clock, Stop while paused, a meter with a reading, a board-only Verilog lesson that runs, and plain words where
// the simulator or the AI is not available.

const clock = (page: Page) => page.getByRole("toolbar", { name: studioRun.bar.label }).getByRole("timer", { name: studioRun.bar.time });

async function openExample(page: Page, title: string) {
  await page.goto("/en/studio");
  await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${title}`) }).click();
  await expect(page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true })).toBeVisible({ timeout: 15_000 });
}

const serialLines = async (page: Page) => (await page.getByRole("log").first().innerText()).split("\n").map((l) => l.replace(/^\[t=[\d.]+ s\]/, "").trim());

async function run(page: Page) {
  await page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true }).click();
  await page.getByRole("toolbar", { name: studioRun.bar.label }).getByRole("button", { name: studioRun.bar.run, exact: true }).click();
  await expect(page.getByText(studioRun.phase.running).first()).toBeVisible();
}

test.describe("the Potentiometer example", () => {
  test("reads one steady value for a fixed knob, and the Inputs slider turns it", async ({ page }) => {
    await openExample(page, studioHome.starters.knob.title);
    // A lesson with an input opens on its guide, where the knob is.
    await expect(page.getByRole("tab", { name: "Guide", exact: true })).toHaveAttribute("aria-selected", "true");
    await run(page);
    await expect.poll(async () => (await serialLines(page)).filter(Boolean).length, { timeout: 15_000 }).toBeGreaterThan(6);
    expect(new Set((await serialLines(page)).filter(Boolean))).toEqual(new Set(["620"]));

    await page.getByRole("tab", { name: "Guide", exact: true }).click();
    await page.getByRole("slider").fill("1000");
    await page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true }).click();
    await expect.poll(async () => (await serialLines(page)).at(-1), { timeout: 15_000 }).toBe("1000");
  });
});

test.describe("the Push button example", () => {
  test("lights the LED while the button is held, and puts it out on release", async ({ page }) => {
    await openExample(page, studioHome.starters.button.title);
    await run(page);
    const lit = page.locator("svg text").filter({ hasText: new RegExp(`^${studioRun.overlay.on}$`) });
    await expect(lit).toHaveCount(0);
    const hold = page.getByRole("button", { name: new RegExp(studio.lesson.inputs.hold) });
    await hold.dispatchEvent("pointerdown", { pointerId: 1 });
    await expect(lit.first()).toBeVisible();
    await page.getByRole("button", { name: new RegExp(studio.lesson.inputs.release) }).dispatchEvent("pointerup", { pointerId: 1 });
    await expect(lit).toHaveCount(0);
  });
});

test.describe("run controls", () => {
  test("Pause, Step and Stop work together", async ({ page }) => {
    await openExample(page, studioHome.starters.blink.title);
    await run(page);
    const bar = page.getByRole("toolbar", { name: studioRun.bar.label });
    await bar.getByRole("button", { name: instruments.run.pause, exact: true }).click();
    await expect(page.getByText(studioRun.phase.paused).first()).toBeVisible();

    const stop = page.getByRole("toolbar", { name: studio.topBar.label }).getByRole("button", { name: studio.topBar.stop });
    await expect(stop).toBeEnabled();

    const before = await clock(page).innerText();
    await bar.getByRole("button", { name: instruments.run.step, exact: true }).click();
    await expect(clock(page)).not.toHaveText(before);

    await stop.click();
    await expect(page.getByText(studioRun.phase.stopped).first()).toBeVisible();
  });
});

test.describe("instruments", () => {
  test("a multimeter on the wiper reads the knob's voltage, from a grouped and searchable list", async ({ page }) => {
    await openExample(page, studioHome.starters.knob.title);
    await run(page);
    const dock = page.getByTestId("instrument-dock");
    await dock.getByRole("button", { name: instruments.dock.add }).click();
    await page.getByRole("menuitem", { name: instruments.kind.multimeter }).click();

    const points = dock.getByRole("combobox", { name: new RegExp(instruments.dock.pickPoint) });
    expect(await points.locator("option").count()).toBeLessThan(80);
    await expect(points.locator(`optgroup[label="${instruments.dock.groupNets}"]`)).toHaveCount(1);
    await dock.getByRole("searchbox", { name: instruments.dock.searchPoints }).fill("POT1 W");
    await expect(points.locator("option")).toHaveCount(2);
    await points.selectOption({ index: 1 });
    await dock.locator("form").getByRole("button", { name: instruments.dock.add }).click();

    await expect(dock.getByRole("status", { name: instruments.meter.reading })).toContainText(/^3\.03 V/);
  });
});

test.describe("the Basys 3 lesson", () => {
  test("runs without an error, and no raw message key reaches the screen", async ({ page }) => {
    await page.goto("/en/studio#/lessons");
    const card = page.locator("li, article").filter({ hasText: "Digilent Basys 3" }).filter({ has: page.getByRole("button", { name: studio.lesson.gallery.startRun }) }).first();
    await card.getByRole("button", { name: studio.lesson.gallery.startRun }).click();
    await expect(page.getByText(studioRun.phase.running).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(studioRun.phase.error)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/\bdiag\.[a-z-]+/);
  });
});

test.describe("FPGA boards", () => {
  for (const [board, switchName, pin] of [["Digilent Basys 3", /^SW0/, "led[2]"], ["Terasic DE10-Lite", /^SW8/, "LEDR[8]"]] as const) {
    test(`${board}: a switch of the Inputs panel lights an LED of the design, and the Board view says so`, async ({ page }) => {
      await page.goto("/en/studio#/lessons");
      const card = page.locator("li, article").filter({ hasText: board }).filter({ has: page.getByRole("button", { name: studio.lesson.gallery.startRun }) }).first();
      await card.getByRole("button", { name: studio.lesson.gallery.startRun }).click();
      await expect(page.getByText(studioRun.phase.running).first()).toBeVisible({ timeout: 20_000 });
      await page.getByRole("tab", { name: "Board", exact: true }).click();
      const state = page.locator("tr").filter({ has: page.getByText(pin, { exact: true }) }).getByText(/^(HIGH|LOW)$/);
      await expect(state).toHaveText("LOW");
      await page.getByRole("switch", { name: switchName }).click();
      await expect(state).toHaveText("HIGH");
    });
  }
});

test.describe("the partner", () => {
  test("asks for your own key when nothing is set up", async ({ page }) => {
    await openExample(page, studioHome.starters.blink.title);
    await page.getByRole("tab", { name: studio.layout.tabs.partner, exact: true }).click();
    await expect(page.getByRole("button", { name: ai.partner.state.notSetUp })).toBeVisible();
    expect(ai.partner.state.notSetUp).not.toMatch(/choose a provider/i);
  });
});
