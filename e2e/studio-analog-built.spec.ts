import { expect, test } from "./support/no-egress";
import { draw, hole, newProject, place, run, stillCanvas, unoPin } from "./support/studio-build";
import instruments from "../src/i18n/messages/en/instruments.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";

// Circuits a student builds from an empty project, not the starters: an RC charge watched on the scope at a slow time
// base, and an LED wired straight to a pin that burns and says why.

test.use({ viewport: { width: 1440, height: 900 } });

test("a scope shows the charge curve of an RC a student built, at real time", async ({ page }) => {
  await newProject(page);
  await place(page, "resistor", /Resistor, through/i, () => hole(page, "a10"));
  const ohms = page.getByLabel(/Resistance/i).first();
  await ohms.fill("10k");
  await ohms.press("Enter");
  await place(page, "electrolytic", /Electrolytic/i, () => hole(page, "b14"));
  const farads = page.getByLabel(/Capacitance/i).first();
  await farads.fill("100u");
  await farads.press("Enter");
  await stillCanvas(page);
  await draw(page, await unoPin(page, "P5V"), await hole(page, "c10"));
  await draw(page, await unoPin(page, "GND"), await hole(page, "c15"));

  await run(page);
  const dock = page.getByTestId("instrument-dock");
  await dock.getByRole("button", { name: instruments.dock.add }).click();
  await page.getByRole("menuitem", { name: instruments.kind.oscilloscope, exact: true }).click();
  await dock.getByRole("searchbox", { name: instruments.dock.searchPoints }).fill("C1");
  await dock.getByRole("combobox", { name: new RegExp(instruments.dock.pickPoint) }).selectOption({ label: "C1 +" });
  await dock.locator("form").getByRole("button", { name: instruments.dock.add }).click();
  const scope = dock.getByTestId("scope");
  await scope.getByLabel(instruments.scope.timePerDiv).selectOption("0.5");

  // The whole window is kept at this time base, so the curve is there and nothing was thrown away.
  await expect(scope.getByTestId("scope-cap")).toHaveText(/ samples kept, 0 dropped$/, { timeout: 15_000 });
  const measure = scope.getByTestId("scope-measure");
  await expect(measure).not.toContainText(instruments.scope.noValue, { timeout: 15_000 });
  await expect.poll(async () => Number.parseFloat(((await measure.locator("tbody td").nth(1).innerText()).match(/^[\d.]+/) ?? ["0"])[0]), { timeout: 20_000 }).toBeGreaterThan(0.5);
  await expect(page.getByText(studioRun.bar.behind)).toHaveCount(0);
  // The plot is on screen without scrolling the dock.
  await expect(scope.locator("svg").first()).toBeInViewport({ ratio: 1 });
});

test("an LED wired straight to a pin burns out and the canvas says which one, with the numbers", async ({ page }) => {
  await newProject(page);
  await place(page, "led", /5 mm through-hole LED/i, () => hole(page, "a10"));
  await draw(page, await unoPin(page, "D13"), await hole(page, "c10"));
  await draw(page, await unoPin(page, "GND"), await hole(page, "c11"));
  await run(page);

  const notice = page.getByTestId("burnt-notice");
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(notice).toContainText(/^D1 burned out: \d+ mA went through it, above the 50 mA \(2\.5 times its 20 mA rating\)/);
  await expect(notice).toContainText("Add a series resistor.");
});

test("a burnt LED is reported on a 4-core device, where the flow lens starts off", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 }));
  await newProject(page);
  await place(page, "led", /5 mm through-hole LED/i, () => hole(page, "a10"));
  await draw(page, await unoPin(page, "D13"), await hole(page, "c10"));
  await draw(page, await unoPin(page, "GND"), await hole(page, "c11"));
  await run(page);

  await expect(page.getByTestId("burnt-notice")).toContainText(/^D1 burned out/, { timeout: 20_000 });
});
