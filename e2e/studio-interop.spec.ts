import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import studio from "../src/i18n/messages/en/studio.json";
import studioHome from "../src/i18n/messages/en/studioHome.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";

// Wokwi in, KiCad and SPICE out, driven from the Project menu. The Wokwi files are the ones the unit tests read.

const FIXTURES = join(__dirname, "..", "src", "export", "wokwi", "fixtures");
const fixture = (name: string, file: string) => join(FIXTURES, name, file);
const text = (name: string, file: string) => readFileSync(fixture(name, file), "utf8");

async function openExample(page: Page, title: string) {
  await page.goto("/en/studio");
  await page.getByRole("list", { name: studioHome.starters.listLabel }).getByRole("button", { name: new RegExp(`^${title}`) }).click();
  await expect(page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true })).toBeVisible({ timeout: 15_000 });
}

async function projectMenu(page: Page, item: string) {
  await page.getByRole("button", { name: studio.projectMenu.label }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

const serialLines = async (page: Page) => (await page.getByRole("log").first().innerText()).split("\n").map((l) => l.replace(/^\[t=[\d.]+ s\]/, "").trim()).filter(Boolean);

test.describe("import a Wokwi project", () => {
  test("a pasted blink becomes a project that runs", async ({ page }) => {
    await openExample(page, studioHome.starters.blink.title);
    await projectMenu(page, studio.interop.menu.wokwi);
    const dialog = page.getByRole("dialog", { name: studio.interop.wokwi.title });
    await dialog.getByLabel(studio.interop.wokwi.pasteDiagram).fill(text("blink", "diagram.json"));
    const sketch = text("blink", "sketch.ino").replace("pinMode(13, OUTPUT);", 'pinMode(13, OUTPUT);\n  Serial.begin(9600);').replace("digitalWrite(13, HIGH);", 'digitalWrite(13, HIGH);\n  Serial.println("on");').replace("digitalWrite(13, LOW);", 'digitalWrite(13, LOW);\n  Serial.println("off");');
    await dialog.getByLabel(studio.interop.wokwi.pasteSketch).fill(sketch);
    await dialog.getByRole("button", { name: studio.interop.wokwi.read }).click();

    await expect(dialog.getByText("Parts imported: 3. Not imported: 0.")).toBeVisible();
    await dialog.getByRole("button", { name: studio.interop.wokwi.confirm }).click();

    await expect(page.getByRole("textbox", { name: studio.topBar.name })).toHaveValue(studio.interop.wokwi.projectTitle);
    await expect(page.getByText("D13", { exact: true }).first()).toBeVisible();
    await page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true }).click();
    await page.getByRole("toolbar", { name: "Run controls" }).getByRole("button", { name: studioRun.bar.run, exact: true }).click();
    await expect(page.getByText(studioRun.phase.running).first()).toBeVisible();
    await expect.poll(() => serialLines(page), { timeout: 15_000 }).toEqual(expect.arrayContaining(["on", "off", "on"]));
  });

  test("files with parts iynk lacks list each one and why", async ({ page }) => {
    await openExample(page, studioHome.starters.blink.title);
    await projectMenu(page, studio.interop.menu.wokwi);
    const dialog = page.getByRole("dialog", { name: studio.interop.wokwi.title });
    await dialog.getByTestId("wokwi-files").setInputFiles([fixture("display-dht", "diagram.json"), fixture("display-dht", "sketch.ino")]);
    await expect(dialog.getByText("Parts imported: 2. Not imported: 4.")).toBeVisible();
    for (const id of ["lcd1", "dht1", "rgb1", "mega"]) await expect(dialog.getByText(new RegExp(`^Not imported: ${id} `))).toBeVisible();
    // Cancel on the review goes back to choosing files; the close button leaves.
    await dialog.getByRole("button", { name: studio.ino.cancel }).click();
    await expect(dialog.getByRole("button", { name: studio.interop.wokwi.read })).toBeVisible();
    await dialog.getByRole("button", { name: studio.layout.close }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a file that is not a diagram says so", async ({ page }) => {
    await openExample(page, studioHome.starters.blink.title);
    await projectMenu(page, studio.interop.menu.wokwi);
    const dialog = page.getByRole("dialog", { name: studio.interop.wokwi.title });
    await dialog.getByLabel(studio.interop.wokwi.pasteDiagram).fill('{"parts": 3}');
    await dialog.getByRole("button", { name: studio.interop.wokwi.read }).click();
    await expect(dialog.getByText(studio.interop.wokwi.errors.notDiagram)).toBeVisible();
  });
});

test.describe("export", () => {
  test("a KiCad netlist with the footprints of the parts", async ({ page }) => {
    await openExample(page, studioHome.starters.blink.title);
    await projectMenu(page, studio.interop.menu.kicad);
    const dialog = page.getByRole("dialog", { name: studio.interop.export.kicadTitle });
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: studio.interop.export.download }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.net$/);
    const body = readFileSync((await file.path())!, "utf8");
    expect(body).toMatch(/^\(export \(version "E"\)/);
    expect(body).toContain('(footprint "LED_THT:LED_D5.0mm")');
    expect(body).toContain('(name "/D13")');
  });

  test("a SPICE deck of an analog starter", async ({ page }) => {
    await openExample(page, studioHome.starters["rc-led"].title);
    await projectMenu(page, studio.interop.menu.spice);
    const dialog = page.getByRole("dialog", { name: studio.interop.export.spiceTitle });
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: studio.interop.export.download }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.cir$/);
    const body = readFileSync((await file.path())!, "utf8");
    expect(body).toMatch(/^R1 /m);
    expect(body).toMatch(/^\.tran /m);
    expect(body.trimEnd().endsWith(".end")).toBe(true);
  });
});
