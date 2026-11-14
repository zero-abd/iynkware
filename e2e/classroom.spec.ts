import { readFileSync, writeFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import { distinctAddress } from "./server-harness";
import assignment from "../src/i18n/messages/en/assignment.json";
import breadboard from "../src/parts/data/breadboard.component.json";
import uno from "../src/parts/data/uno-r3.component.json";
import studio from "../src/i18n/messages/en/studio.json";
import studioEdit from "../src/i18n/messages/en/studioEdit.json";
import studioHome from "../src/i18n/messages/en/studioHome.json";

// A teacher makes the Blink assignment and copies its link. A student, in a browser that has never seen iynk, opens
// it, wires the LED on the breadboard, checks the work and hands in. The teacher grades the hand-in, and a file the
// student edited afterwards is caught because the checks run again on the teacher's side.

test.use({ viewport: { width: 1440, height: 900 } });

const PIN_DOT = 'circle[fill="var(--studio-pin)"]';
const holeNames = breadboard.pins.map((p) => p.id);
const unoPins = uno.pins.filter((p) => p.type !== "mechanical").map((p) => p.id);

const canvas = (page: Page) => page.getByRole("application", { name: studio.canvas.label });

async function centre(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("the element is not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const hole = (page: Page, name: string) => centre(page.locator(`[data-kind="surface"] ${PIN_DOT}`).nth(holeNames.indexOf(name)));
const unoPin = (page: Page, name: string) => centre(page.locator(`g[data-kind="part"]:has(> title:text-is("U1")) ${PIN_DOT}`).nth(unoPins.indexOf(name)));

async function draw(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

/** Waits until the canvas stops moving, so a hole read now is where the pointer will find it. */
async function stillCanvas(page: Page) {
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 2);
  let last = "";
  await expect(async () => {
    const now = JSON.stringify(await hole(page, "a1"));
    const steady = now === last;
    last = now;
    await page.waitForTimeout(200);
    expect(steady).toBe(true);
  }).toPass({ timeout: 10_000 });
}

async function place(page: Page, search: string, name: RegExp, where: () => Promise<{ x: number; y: number }>) {
  await page.getByRole("searchbox", { name: studioEdit.palette.search }).fill(search);
  await page.getByRole("button", { name }).first().click();
  await expect(page.getByText(/ is ready\. Click or tap to place it/)).toBeVisible();
  await stillCanvas(page);
  const at = await where();
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
}

const dialog = (page: Page) => page.getByRole("dialog", { name: assignment.make.title });

async function addCheck(page: Page, kind: string, fields: { part?: string; pin?: string; from?: string; to?: string; at?: string; window?: string }) {
  const form = dialog(page).getByRole("group", { name: assignment.make.add });
  await form.getByLabel(assignment.make.kindField).selectOption({ label: kind });
  if (fields.part) await form.getByLabel(assignment.make.partField).selectOption({ label: fields.part });
  if (fields.pin) await form.getByLabel(assignment.make.pinField).selectOption({ label: fields.pin });
  if (fields.from) await form.getByLabel(assignment.make.fromField, { exact: true }).fill(fields.from);
  if (fields.to) await form.getByLabel(assignment.make.toField, { exact: true }).fill(fields.to);
  if (fields.at) await form.getByLabel(assignment.make.atField).fill(fields.at);
  if (fields.window) await form.getByLabel(assignment.make.windowField).fill(fields.window);
  await form.getByRole("button", { name: assignment.make.addButton }).click();
}

async function makeAssignment(page: Page): Promise<string> {
  await page.goto("/en/studio");
  await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${studioHome.starters.blink.title}`) }).click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: studio.projectMenu.label }).click();
  await page.getByRole("menuitem", { name: assignment.make.open }).click();

  const form = dialog(page);
  await form.getByLabel(assignment.make.titleField).fill("Blink an LED on the breadboard");
  await form.getByLabel(assignment.make.instructionsField).fill("Put LED1 and a resistor on the breadboard and wire pin D13 through them to GND.");
  await form.getByLabel(assignment.make.starterField).selectOption({ label: assignment.make.starter["board-only"] });
  await form.getByRole("switch", { name: "BB1" }).click();

  await addCheck(page, assignment.kind["pin-volts"], { part: "LED1", pin: "A", from: "1.4", to: "4", at: "200" });
  await addCheck(page, assignment.kind["part-amps"], { part: "LED1", from: "0.001", to: "0.03", at: "200" });
  await addCheck(page, assignment.kind["pin-frequency"], { part: "U1", pin: "D13", from: "0.9", to: "1.1", at: "3000", window: "2000" });
  await addCheck(page, assignment.kind["no-errors"], {});
  await expect(form.getByTestId("make-check")).toHaveCount(4);

  await form.getByRole("button", { name: assignment.make.copyLink }).click();
  const link = form.getByLabel(assignment.make.linkField);
  await expect(link).toBeVisible();
  const value = await link.inputValue();
  expect(value).toMatch(/\/en\/studio#assignment=[A-Za-z0-9_-]+$/);
  expect(value.length).toBeLessThan(8300);
  // The same form gives the same link again, and the file is there to save without the link being too large.
  await form.getByRole("button", { name: assignment.make.copyLink }).click();
  await expect(link).toHaveValue(value);
  const download = page.waitForEvent("download");
  await form.getByRole("button", { name: assignment.make.saveFile }).click();
  expect((await download).suggestedFilename()).toMatch(/\.iynk$/);
  await form.getByRole("button", { name: assignment.make.close }).click();
  return value;
}

test("a teacher hands out a blink assignment, a student wires it and hands in, and the teacher's view grades it again", async ({ page, browser }, info) => {
  const link = await makeAssignment(page);

  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  await distinctAddress(context);
  const student = await context.newPage();
  await student.goto(link);

  const bar = student.getByTestId("assignment-bar");
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await expect(bar.getByRole("heading", { name: "Blink an LED on the breadboard" })).toBeVisible();
  await expect(bar).toContainText("wire pin D13 through them to GND");
  await expect(canvas(student)).toBeVisible();
  await stillCanvas(student);
  await expect(bar.getByTestId("assignment-check")).toHaveCount(4);

  // Nothing is wired yet: the frequency of the board pin and the clean run pass, the meters say what to do.
  await bar.getByRole("button", { name: assignment.bar.check }).click();
  await expect(bar.getByText("2 of 4 checks pass")).toBeVisible({ timeout: 60_000 });
  await expect(bar.getByTestId("assignment-check").first()).toHaveAttribute("data-state", "fail");
  await expect(bar).toContainText("Put a meter on that pin");

  // The breadboard is locked: Delete leaves it where it is.
  await student.locator('[data-kind="surface"]').first().click({ position: { x: 5, y: 5 }, force: true });
  await student.keyboard.press("Delete");
  await expect(student.locator('[data-kind="surface"]')).toBeVisible();

  await place(student, "resistor", /Resistor, through/i, () => hole(student, "a10"));
  const ohms = student.getByLabel(/Resistance/i).first();
  await ohms.fill("330");
  await ohms.press("Enter");
  await place(student, "led", /5 mm through-hole LED/i, () => hole(student, "c14"));
  await stillCanvas(student);
  await draw(student, await unoPin(student, "D13"), await hole(student, "c10"));
  await draw(student, await unoPin(student, "GND"), await hole(student, "d15"));

  await bar.getByRole("button", { name: assignment.bar.check }).click();
  await expect(bar.getByText("4 of 4 checks pass")).toBeVisible({ timeout: 60_000 });
  await expect(bar.locator('[data-state="pass"]')).toHaveCount(4);

  await bar.getByRole("button", { name: assignment.bar.handIn }).click();
  const hand = student.getByRole("dialog", { name: assignment.handIn.title });
  await hand.getByRole("button", { name: assignment.handIn.download }).click();
  await expect(hand.getByText(assignment.handIn.nameRequired)).toBeVisible();
  await hand.getByLabel(assignment.handIn.name).fill("Ada Lovelace");
  const [download] = await Promise.all([student.waitForEvent("download"), hand.getByRole("button", { name: assignment.handIn.download }).click()]);
  expect(download.suggestedFilename()).toBe("Blink-an-LED-on-the-breadboard-Ada-Lovelace.iynk-submission.json");
  const honest = info.outputPath("honest.json");
  await download.saveAs(honest);
  await context.close();

  // The same file with the code edited afterwards: the hash no longer matches and the blink is too fast for the frequency check, while the LED is still on at the 200 ms the other two read.
  const edited = JSON.parse(readFileSync(honest, "utf8")) as { project: { sources: { content: string }[] } };
  edited.project.sources[0]!.content = edited.project.sources[0]!.content.replaceAll("500", "300");
  const tampered = info.outputPath("tampered.json");
  writeFileSync(tampered, JSON.stringify(edited));

  await page.getByRole("button", { name: studio.projectMenu.label }).click();
  await page.getByRole("menuitem", { name: assignment.grade.title }).click();
  await expect(page.getByRole("heading", { name: assignment.grade.title })).toBeVisible();
  await page.getByLabel(assignment.grade.saved).selectOption({ label: "Blink an LED on the breadboard" });
  await expect(page.getByText("Blink an LED on the breadboard: 4 checks")).toBeVisible();

  await page.getByTestId("grade-files").setInputFiles([honest, tampered]);
  const rows = page.getByTestId("grade-row");
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId("grade-score")).toHaveText(["4/4", "3/4"], { timeout: 90_000 });
  await expect(rows.nth(0)).toContainText("Ada Lovelace");
  await expect(rows.nth(0)).toContainText(assignment.grade.ok);
  await expect(rows.nth(1)).toContainText(assignment.grade.hashBad);
  await expect(rows.nth(1)).toContainText(assignment.grade.mismatch);

  await rows.nth(0).getByRole("button", { name: assignment.grade.open }).click();
  await expect(canvas(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("assignment-bar")).toContainText("Blink an LED on the breadboard");
  await expect(page.locator('[data-kind="part"]:has(> title:text-is("LED1")), [data-kind="part"]:has(> title:text-is("D1"))').first()).toBeVisible();
});
