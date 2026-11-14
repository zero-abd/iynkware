import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import breadboard from "../src/parts/data/breadboard.component.json";
import nano from "../src/parts/data/nano.component.json";
import uno from "../src/parts/data/uno-r3.component.json";
import studio from "../src/i18n/messages/en/studio.json";
import studioEdit from "../src/i18n/messages/en/studioEdit.json";
import studioHome from "../src/i18n/messages/en/studioHome.json";
import studioInspect from "../src/i18n/messages/en/studioInspect.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";

// The canvas finish: the Uno drawn with its pins on the real header positions, wires that take a colour and a net class
// from the pins they join, a seated part that turns only when its legs land on free holes, and the buttons, switches and
// pots of a running circuit worked with the pointer.

test.use({ viewport: { width: 1440, height: 900 } });

const PIN_DOT = 'circle[fill="var(--studio-pin)"]';
const holeNames = breadboard.pins.map((p) => p.id);
const unoPins = uno.pins.filter((p) => p.type !== "mechanical").map((p) => p.id);

const canvas = (page: Page) => page.getByRole("application", { name: studio.canvas.label });
const status = (page: Page) => page.getByRole("status").filter({ hasText: /\S/ });
const topBar = (page: Page) => page.getByRole("toolbar", { name: studio.topBar.label });

async function centre(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("the element is not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const hole = (page: Page, name: string) => centre(page.locator(`[data-kind="surface"] ${PIN_DOT}`).nth(holeNames.indexOf(name)));
const unoPin = (page: Page, name: string) => centre(page.locator(`g[data-kind="part"]:has(> title:text-is("U1")) ${PIN_DOT}`).nth(unoPins.indexOf(name)));
const part = (page: Page, refdes: string) => page.locator(`g[data-kind="part"]:has(> title:text-is("${refdes}"))`);

async function draw(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

async function place(page: Page, search: string, name: RegExp, where: () => Promise<{ x: number; y: number }>) {
  await page.getByRole("searchbox", { name: studioEdit.palette.search }).fill(search);
  await page.getByRole("button", { name }).first().click();
  // The notice that the part is armed takes a line under the canvas and moves it, so measure after it and once it is still.
  await expect(page.getByText(/ is ready\. Click or tap to place it/)).toBeVisible();
  await stillCanvas(page);
  const at = await where();
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Waits until the canvas stops moving, so a hole read now is where the pointer will find it. The first time the pointer is
 * over the canvas its status bar gains a line and the canvas shrinks, so the pointer goes there first.
 */
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

async function newProject(page: Page) {
  await page.goto("/en/studio");
  await page.getByRole("button", { name: studio.newProject, exact: true }).click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-kind="surface"]')).toBeVisible();
  await stillCanvas(page);
}

test.describe("the Uno on the canvas", () => {
  test.beforeEach(async ({ page }) => newProject(page));

  test("has its pin dots on the header positions of the real board", async ({ page }) => {
    const at = async (name: string) => unoPin(page, name);
    const [d0, d1, d7, d8, d9, scl, a0, a5, vin, nc] = await Promise.all(["D0", "D1", "D7", "D8", "D9", "SCL", "A0", "A5", "VIN", "NC"].map(at));
    const pitch = d0!.x - d1!.x;
    expect(pitch).toBeGreaterThan(4);
    // The 160 mil gap between D7 and D8 is 1.6 pitches; every other step on a header is one pitch.
    expect((d7!.x - d8!.x) / pitch).toBeCloseTo(1.6, 1);
    expect((d8!.x - d9!.x) / pitch).toBeCloseTo(1, 1);
    expect(Math.abs(d0!.y - scl!.y)).toBeLessThan(1);
    expect((a5!.x - a0!.x) / pitch).toBeCloseTo(5, 1);
    expect((a0!.x - vin!.x) / pitch).toBeCloseTo(2, 1);
    expect((vin!.x - nc!.x) / pitch).toBeCloseTo(7, 1);
    // The digital headers sit along the top edge and the power and analog headers along the bottom, 50.8 mm of 53.34 apart.
    expect((a0!.y - d0!.y) / pitch).toBeCloseTo(48.26 / 2.54, 0);
    const board = (await part(page, "U1").boundingBox())!;
    expect(board.width / board.height).toBeGreaterThan(68.58 / 53.34 - 0.1);
    expect(nano.pins.every((p) => p.position)).toBe(true);
  });

  test("draws a board with its USB jack, headers and chip, not a plain box", async ({ page }) => {
    const board = part(page, "U1");
    await expect(board.locator("rect").first()).toBeVisible();
    expect(await board.locator("rect, path, circle").count()).toBeGreaterThan(40);
    await expect(board.locator("text", { hasText: "UNO" })).toHaveCount(1);
  });
});

test.describe("wire colours and net classes", () => {
  test.beforeEach(async ({ page }) => newProject(page));

  const stroke = (page: Page, n: number) => page.locator('g[data-kind="wire"] path').nth(n);
  const wires = (page: Page, colour: string) => page.locator(`g[data-kind="wire"] path[stroke="var(--studio-wire-${colour})"]`);

  test("a new wire takes a colour from its pins and sets the net class, and the Inspector changes both", async ({ page }) => {
    await draw(page, await unoPin(page, "GND"), await hole(page, "a15"));
    await draw(page, await unoPin(page, "P5V"), await hole(page, "a20"));
    await draw(page, await unoPin(page, "D13"), await hole(page, "a10"));
    await expect(page.locator('g[data-kind="wire"]')).toHaveCount(3);
    await expect(stroke(page, 0)).toHaveAttribute("stroke", "var(--studio-wire-black)");
    await expect(wires(page, "red")).toHaveCount(1);
    await expect(wires(page, "blue")).toHaveCount(0);
    const plain = await stroke(page, 2).getAttribute("stroke");
    expect(plain).not.toMatch(/black|red/);

    // The red wire runs along the bottom edge of its box and then up; the stretch between the boards is bare canvas.
    const box = (await page.locator('g[data-kind="wire"]').nth(1).boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.39, box.y + box.height - 1.5);
    const inspector = page.getByRole("region", { name: studioInspect.sections.wire });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByLabel(studioInspect.wire.netClass)).toHaveValue("power");

    await inspector.getByRole("radio", { name: studioInspect.wire.colors.blue }).click();
    await expect(wires(page, "blue")).toHaveCount(1);
    await expect(wires(page, "red")).toHaveCount(0);
    await inspector.getByLabel(studioInspect.wire.netClass).selectOption("analog");
    await expect(inspector.getByLabel(studioInspect.wire.netClass)).toHaveValue("analog");

    await page.keyboard.press("ControlOrMeta+z");
    await expect(inspector.getByLabel(studioInspect.wire.netClass)).toHaveValue("power");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(wires(page, "red")).toHaveCount(1);
    await expect(wires(page, "blue")).toHaveCount(0);
  });
});

test.describe("turning a part seated in holes", () => {
  // The Blink starter seats R1 in b10 and b14. Turned about b10 its other leg has no hole to land in one way and a free
  // rail hole the other way.
  test.beforeEach(async ({ page }) => {
    await page.goto("/en/studio");
    await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${studioHome.starters.blink.title}`) }).click();
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    await expect(part(page, "RES1")).toBeVisible();
    // The canvas picks the holes under a seated part first, so the part is chosen from the Outline.
    await page.getByRole("tab", { name: studio.layout.tabs.outline, exact: true }).click();
    await page.getByRole("treeitem", { name: /RES1/ }).first().click();
    await expect(page.getByText(/^1 selected$/)).toBeVisible();
    await page.getByRole("tab", { name: studio.layout.tabs.inspector, exact: true }).click();
  });

  const refused = (page: Page) => status(page).filter({ hasText: /^RES1 did not turn: the turned legs would not land on free holes/ });

  test("leaves it where it is and says why when the turned legs find no holes", async ({ page }) => {
    const r1 = part(page, "RES1");
    const flat = await r1.getAttribute("transform");
    await page.keyboard.press("r");
    await expect(refused(page)).toBeVisible();
    expect(await r1.getAttribute("transform")).toBe(flat);
  });

  test("seats it again in the hole the turned leg lands on, and the reason goes when it turns", async ({ page }) => {
    const r1 = part(page, "RES1");
    await page.keyboard.press("r");
    await expect(refused(page)).toBeVisible();
    await page.keyboard.press("Shift+R");
    await expect(r1).toHaveAttribute("transform", /rotate\(-90\)/);
    await expect(refused(page)).toHaveCount(0);
    await page.keyboard.press("r");
    await expect(r1).not.toHaveAttribute("transform", /rotate/);
  });

  test("the Inspector gives the reason beside the field and keeps the turn", async ({ page }) => {
    const turn = page.getByLabel(studioInspect.position.rotation, { exact: true });
    await turn.selectOption("270");
    await expect(page.getByRole("alert").filter({ hasText: studioInspect.position.turnRefused })).toBeVisible();
    await expect(turn).toHaveValue("0");
  });

  test("the Inspector seats it again when the legs fit", async ({ page }) => {
    const turn = page.getByLabel(studioInspect.position.rotation, { exact: true });
    await turn.selectOption("90");
    await expect(turn).toHaveValue("90");
    await expect(part(page, "RES1")).toHaveAttribute("transform", /rotate\(-90\)/);
    await expect(page.getByRole("alert").filter({ hasText: studioInspect.position.turnRefused })).toHaveCount(0);
  });
});

test.describe("working a running circuit with the pointer", () => {
  const lit = (page: Page) => page.locator('[data-kind="overlay"] text').filter({ hasText: new RegExp(`^${studioRun.overlay.on}$`) });

  test("a press on the button holds it down until release, and the LED follows", async ({ page }) => {
    await page.goto("/en/studio");
    await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${studioHome.starters.button.title}`) }).click();
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    await topBar(page).getByRole("button", { name: studioRun.bar.run, exact: true }).click();
    await expect(page.getByText(studioRun.phase.running).first()).toBeVisible({ timeout: 15_000 });
    await expect(lit(page)).toHaveCount(0);

    // The pointer's first visit to the canvas and the running state both move it; measure the button once it is still.
    await stillCanvas(page);
    const button = part(page, "BTN1");
    const at = await centre(button);
    // The cursor is worked out when the pointer moves, and a run that starts under load can let the button be worked
    // after the pointer arrived on it, so move again until the canvas says it can be pressed.
    await expect(async () => {
      await page.mouse.move(at.x - 1, at.y);
      await page.mouse.move(at.x, at.y);
      await expect(canvas(page)).toHaveCSS("cursor", "pointer", { timeout: 500 });
    }).toPass({ timeout: 10_000 });
    await page.mouse.down();
    await expect(lit(page).first()).toBeVisible({ timeout: 10_000 });
    await page.mouse.up();
    await expect(lit(page)).toHaveCount(0, { timeout: 10_000 });
  });

  test("dragging round the pot of the Potentiometer example turns the knob, and the sketch reads the new value", async ({ page }) => {
    await page.goto("/en/studio");
    await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${studioHome.starters.knob.title}`) }).click();
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true }).click();
    await topBar(page).getByRole("button", { name: studioRun.bar.run, exact: true }).click();
    const lines = async () => (await page.getByRole("log").first().innerText()).split("\n").map((l) => l.replace(/^\[t=[\d.]+ s\]/, "").trim()).filter(Boolean);
    await expect.poll(async () => (await lines()).at(-1), { timeout: 15_000 }).toBe("620");

    const knob = part(page, "POT1");
    const at = await centre(knob);
    const r = 14;
    await page.mouse.move(at.x + r, at.y);
    await expect(canvas(page)).toHaveCSS("cursor", "grab");
    await page.mouse.down();
    await page.mouse.move(at.x, at.y + r, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => Number((await lines()).at(-1)), { timeout: 15_000 }).toBeGreaterThan(620);
    const higher = Number((await lines()).at(-1));
    await page.mouse.move(at.x + r, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y - r, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => Number((await lines()).at(-1)), { timeout: 15_000 }).toBeLessThan(higher);
  });

  test("a slide switch flips on a click and a pot turns when its body is dragged round", async ({ page }) => {
    await newProject(page);
    const box = (await canvas(page).boundingBox())!;
    // The empty strips either side of the boards; the lower edge of the canvas moves when the run starts.
    const spot = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
    await place(page, "slide switch", /slide switch/i, async () => spot(0.06, 0.5));
    await expect(status(page).filter({ hasText: /^Placed SW1/ })).toBeVisible();
    await place(page, "potentiometer", /potentiometer/i, async () => spot(0.94, 0.5));
    const placed = status(page).filter({ hasText: /^Placed (?!SW1)\S+ on the canvas/ });
    await expect(placed).toBeVisible();
    const potName = /^Placed (\S+)/.exec(await placed.innerText())![1]!;

    await topBar(page).getByRole("button", { name: studioRun.bar.run, exact: true }).click();
    await expect(page.getByText(studioRun.phase.running).first()).toBeVisible({ timeout: 15_000 });

    const switchAt = await centre(part(page, "SW1"));
    await expect(async () => {
      await page.mouse.move(switchAt.x + 2, switchAt.y);
      await page.mouse.move(switchAt.x, switchAt.y);
      await expect(canvas(page)).toHaveCSS("cursor", "pointer", { timeout: 500 });
    }).toPass({ timeout: 10_000 });
    await page.mouse.click(switchAt.x, switchAt.y);
    const marks = page.locator('[data-kind="overlay"] text');
    await expect(marks.filter({ hasText: /^B$/ })).toHaveCount(1);
    await page.mouse.click(switchAt.x, switchAt.y);
    await expect(marks.filter({ hasText: /^A$/ })).toHaveCount(1);

    const knobAt = await centre(part(page, potName));
    const r = 12;
    await expect(async () => {
      await page.mouse.move(knobAt.x + r - 2, knobAt.y);
      await page.mouse.move(knobAt.x + r, knobAt.y);
      await expect(canvas(page)).toHaveCSS("cursor", "grab", { timeout: 500 });
    }).toPass({ timeout: 10_000 });
    await page.mouse.down();
    await page.mouse.move(knobAt.x, knobAt.y + r, { steps: 12 });
    await expect(marks.filter({ hasText: /^\d+%$/ })).toHaveCount(1);
    const turned = (await marks.filter({ hasText: /^\d+%$/ }).textContent())!;
    expect(Number.parseInt(turned, 10)).toBeGreaterThan(50);
    await page.mouse.move(knobAt.x - r, knobAt.y, { steps: 12 });
    expect(Number.parseInt((await marks.filter({ hasText: /^\d+%$/ }).textContent())!, 10)).toBeGreaterThan(Number.parseInt(turned, 10));
    await page.mouse.up();
  });
});
