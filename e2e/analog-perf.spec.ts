import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import { ladderFile } from "./support/ladder";
import studio from "../src/i18n/messages/en/studio.json";
import studioHome from "../src/i18n/messages/en/studioHome.json";
import studioRun from "../src/i18n/messages/en/studioRun.json";
import instruments from "../src/i18n/messages/en/instruments.json";

// RS-08(b), SIMULATION 7.4: the transient solve of a 16 ms frame against the frame. Each circuit runs in the real worker
// "as fast as possible", and the speed the worker reports says what one 16 ms frame costs: 16 ms / speed. The CPU throttle
// of DevTools does not reach a worker (the speed at 4x and 6x measured the same as at 1x), so the worker's cost is
// taken at 1x and multiplied by the throttle: a frame has to cost no more than the frame at 4x. 6x is recorded.

const FRAME_MS = 16;
const GATED_THROTTLE = 4;
const RECORDED_THROTTLE = 6;
const SETTLE_MS = 9000;
const WINDOW = 4;

const STARTERS = studioHome.starters;
const STARTER_TITLES = [STARTERS["rc-led"].title, STARTERS["blinker-555"].title, STARTERS["opamp-amplifier"].title, STARTERS.rectifier.title, STARTERS["zener-regulator"].title];
const LADDER_STAGES = 14;

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const results: Record<string, { speed: number; msPerFrame: number; at4x: number; at6x: number }> = {};

async function speedOf(page: Page): Promise<number> {
  await page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true }).click();
  await page.getByRole("toolbar", { name: studioRun.bar.label }).getByRole("button", { name: studioRun.bar.run, exact: true }).click();
  await expect(page.getByText(studioRun.phase.running).first()).toBeVisible();
  await page.getByRole("radio", { name: instruments.speed.max }).click();
  await page.waitForTimeout(SETTLE_MS);
  const reports = await page.evaluate(() => (window as unknown as { __speeds: number[] }).__speeds);
  expect(reports.length, "speed reports from the worker").toBeGreaterThanOrEqual(WINDOW);
  const last = reports.slice(-WINDOW);
  return last.reduce((a, b) => a + b, 0) / last.length;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const speeds: number[] = [];
    (window as unknown as { __speeds: number[] }).__speeds = speeds;
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (e) => {
          if (e.data?.t === "speed.report") speeds.push(e.data.achieved);
        });
      }
    };
    // Forces the file input, which a test can fill, in place of the browser's picker.
    (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker = undefined;
  });
  await page.goto("/en/studio");
});

function record(name: string, speed: number) {
  const msPerFrame = FRAME_MS / speed;
  results[name] = { speed, msPerFrame, at4x: msPerFrame * GATED_THROTTLE, at6x: msPerFrame * RECORDED_THROTTLE };
  return results[name];
}

for (const title of STARTER_TITLES) {
  test(`${title} costs a frame less than a frame at 4x CPU`, async ({ page }) => {
    await page.getByRole("list", { name: STARTERS.listLabel }).getByRole("button", { name: new RegExp(`^${title}`) }).click();
    await expect(page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true })).toBeVisible({ timeout: 15_000 });
    const r = record(title, await speedOf(page));
    expect(r.at4x, `${title}: ms per ${FRAME_MS} ms frame at 4x`).toBeLessThanOrEqual(FRAME_MS);
  });
}

test(`a ${LADDER_STAGES * 3}-part RC and diode ladder costs a frame less than a frame at 4x CPU`, async ({ page }, info) => {
  const file = info.outputPath("ladder.iynk");
  mkdirSync(info.outputDir, { recursive: true });
  writeFileSync(file, ladderFile(LADDER_STAGES));
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: studio.openFromFile }).click();
  await (await chooser).setFiles(file);
  await page.getByRole("button", { name: studio.row.open.replace("{name}", "Ladder"), exact: true }).click();
  await expect(page.getByRole("tab", { name: studio.layout.tabs.serial, exact: true })).toBeVisible({ timeout: 15_000 });
  const r = record("ladder", await speedOf(page));
  mkdirSync(".perf", { recursive: true });
  writeFileSync(".perf/analog-perf.json", `${JSON.stringify({ frameMs: FRAME_MS, throttleReachesWorker: false, results }, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
  expect(r.at4x, `ladder: ms per ${FRAME_MS} ms frame at 4x`).toBeLessThanOrEqual(FRAME_MS);
});
