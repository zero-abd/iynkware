import { expect, test } from "./support/no-egress";
import fidelity from "../src/i18n/messages/en/fidelity.json";
import studio from "../src/i18n/messages/en/studio.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";

// Inspect on a Verilog board: a click loads the Yosys engine from /engines, checked against its hash, and the dialog
// lists the cells and wires the design makes. This is the only test that loads the 68 MB engine in a browser.
test("a Basys 3 design is inspected with Yosys in the browser", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/en/studio#/lessons");
  const card = page
    .locator("li, article")
    .filter({ hasText: "Digilent Basys 3" })
    .filter({ has: page.getByRole("button", { name: studio.lesson.gallery.startRun }) })
    .first();
  await card.getByRole("button", { name: studio.lesson.gallery.startRun }).click();
  await expect(page.getByText(studioRun.phase.running).first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true }).click();
  await page.getByRole("button", { name: fidelity.inspect.title }).click();
  const dialog = page.getByRole("dialog", { name: fidelity.inspect.title });
  await expect(dialog.getByText(/^Download [\d.]+ MB/)).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: fidelity.inspect.load }).click();
  await expect(dialog.getByText(/^Inspected: [1-9]\d* cells, [1-9]\d* wires$/)).toBeVisible({ timeout: 90_000 });
  await expect(dialog.getByText(fidelity.inspect.failed)).toHaveCount(0);
});
