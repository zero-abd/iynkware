import { expect, test } from "./support/no-egress";
import { draw, hole, newProject, place, run, unoPin } from "./support/studio-build";
import faults from "../src/i18n/messages/en/faults.json";
import studio from "../src/i18n/messages/en/studio.json";

// A fix is a change to the project like any other: it goes through the document, one undo takes it back, and the
// finding is gone on the next check.

test.use({ viewport: { width: 1440, height: 900 } });

test("an LED straight on D13 burns, the Problems panel offers a resistor, Fix puts it in and the LED stops burning", async ({ page }) => {
  await newProject(page);
  await place(page, "led", /5 mm through-hole LED/i, () => hole(page, "a10"));
  await draw(page, await unoPin(page, "D13"), await hole(page, "c10"));
  await draw(page, await unoPin(page, "GND"), await hole(page, "c11"));
  await run(page);

  const notice = page.getByTestId("burnt-notice");
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: studio.layout.tabs.problems, exact: true }).click();
  const problems = page.getByTestId("problems");
  await expect(problems.getByText(faults.cause["led-no-series-resistor"].title)).toBeVisible();
  const fix = problems.getByTestId("problem-fix");
  await expect(fix).toContainText("Add a 330 Ω resistor in series with D1.");
  await expect(fix).toContainText(faults.fixUi.before);
  await expect(fix).toContainText("R1: 330 Ω");

  await fix.getByRole("button", { name: faults.fixUi.apply, exact: true }).click();
  await expect(problems.getByText(/^Fixed: Add a 330/)).toBeVisible();
  await expect(problems.getByText(faults.cause["led-no-series-resistor"].title)).toHaveCount(0);
  await expect(problems.getByTestId("problem-fix")).toHaveCount(0);
  // The run starts again on the changed circuit, and the LED survives it.
  await expect(notice).toHaveCount(0);
  await expect(page.getByText(/D1 burned out/)).toHaveCount(0);
  await page.waitForTimeout(2_000);
  await expect(notice).toHaveCount(0);
  await expect(problems.getByText(faults.cause["led-no-series-resistor"].title)).toHaveCount(0);

  await problems.getByRole("button", { name: faults.fixUi.undo, exact: true }).click();
  await expect(problems.getByText(faults.cause["led-no-series-resistor"].title)).toBeVisible({ timeout: 10_000 });
});
