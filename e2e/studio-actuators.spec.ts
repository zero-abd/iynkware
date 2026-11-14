import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import { writeIynk } from "../src/export/iynk";
import type { Project } from "../src/project/generated/types";
import actuators from "./fixtures/actuators.project.json";
import studio from "../src/i18n/messages/en/studio.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";

// An Uno writes the servo to 135 degrees and switches a DC motor on a pack through a TIP120 with analogWrite.

const PROJECT = "Servo and motor";

const SWEEP = `#include <Servo.h>

Servo arm;

void setup() {
  arm.attach(9);
  pinMode(6, OUTPUT);
  analogWrite(6, 200);
}

void loop() {
  arm.write(20);
  delay(400);
  arm.write(160);
  delay(400);
}
`;

async function open(page: Page, outputPath: (name: string) => string, sketch?: string): Promise<void> {
  const project = structuredClone(actuators) as unknown as Project;
  if (sketch) project.sources = project.sources.map((s) => (s.role === "firmware" ? { ...s, content: sketch } : s));
  project.id = "prj_actuators_e2e";
  project.meta = { ...project.meta, title: PROJECT };
  const file = outputPath("actuators.iynk");
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
const tags = (page: Page, text: RegExp) => page.locator("svg text").filter({ hasText: text });

async function run(page: Page): Promise<void> {
  await bar(page).getByRole("button", { name: studioRun.bar.run, exact: true }).click();
  await expect(bar(page).getByRole("status").filter({ hasText: studioRun.phase.running })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => void ((window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker = undefined));
});

test.describe("a servo and a DC motor in a run", () => {
  test("shows the servo's arm angle and the motor's speed", async ({ page }, info) => {
    await open(page, (name) => info.outputPath(name));
    await run(page);
    await expect(tags(page, /^135°$/)).toBeVisible({ timeout: 15_000 });
    await expect(tags(page, /^\d{4,} rpm$/)).toBeVisible({ timeout: 15_000 });
  });

  test("follows a sketch that moves the arm back and forth", async ({ page }, info) => {
    await open(page, (name) => info.outputPath(name), SWEEP);
    await run(page);
    await expect(tags(page, /^20°$/)).toBeVisible({ timeout: 15_000 });
    await expect(tags(page, /^160°$/)).toBeVisible({ timeout: 15_000 });
  });
});
