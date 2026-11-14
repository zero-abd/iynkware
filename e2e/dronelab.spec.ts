import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/no-egress";
import dronelab from "../src/i18n/messages/en/dronelab.json";
import flight from "../src/i18n/messages/en/flight.json";

// Drone Lab, quad5 (Fig. 01): the index, the workshop (design, build, safety tests, CLI, keyboard) and the
// flying range. The figure is the real built page (public/figures/drones/quad5.html).

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat|did not match|Minified React error/i.test(message.text()))
      errors.push(message.text());
  });
  return errors;
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const main = (page: Page) => page.locator("main#main-en");
const tab = (page: Page, name: string) => main(page).getByRole("tab", { name, exact: true });
const fill = (template: string, params: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k]));

async function openWorkshop(page: Page) {
  await page.goto("/en/drones/quad5");
  // The figure has answered `ready` once the bench status shows a parts count.
  await expect(main(page).getByTestId("bench-status")).toContainText(/\d+\/\d+/, { timeout: 20_000 });
}

test("the index lists the 13 crafts and passes axe", async ({ page }) => {
  const errors = watchErrors(page);
  const response = await page.goto("/en/drones");
  expect(response?.status()).toBe(200);
  await expect(main(page).getByRole("heading", { level: 1, name: dronelab.index.title })).toBeVisible();
  await expect(main(page).locator("ul > li > article")).toHaveCount(13);
  const quad5 = main(page).locator('a[href="/en/drones/quad5"]');
  await expect(quad5).toBeVisible();
  await expect(main(page).getByRole("progressbar").first()).toHaveAttribute("aria-valuetext", /0 of \d+ done/);
  await expectNoAxeViolations(page);
  expect(errors).toEqual([]);
});

test.describe("quad5 workshop", () => {
  test("a design option changes the live calculation", async ({ page }) => {
    const errors = watchErrors(page);
    await openWorkshop(page);
    const tiles = main(page).getByTestId("design-tiles");
    const auw = tiles.locator('[data-tile="auw"] dd');
    const before = await auw.textContent();
    await main(page).getByLabel(dronelab.design.battery, { exact: true }).selectOption("6s1800");
    await expect(auw).not.toHaveText(before ?? "");
    await expect(auw).toHaveText(/^\d[\d,]* g$/);
    // A 2450 KV motor on 6S spins far too fast: the check says so.
    await main(page).getByLabel(dronelab.design.motors, { exact: true }).selectOption("2306-2450");
    await expect(main(page).getByText(/2,450 KV on 6S spins the props/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the three safety tests run on the bench", async ({ page }) => {
    test.setTimeout(90_000);
    await openWorkshop(page);
    await tab(page, dronelab.workspace.tabs.build).click();
    // the empty mat offers the same button over the figure; this is the Build tab's
    await main(page).getByRole("tabpanel").getByRole("button", { name: dronelab.build.buildForMe }).click();
    await expect(main(page).getByTestId("build-count")).toHaveText(/^Parts (\d+)\/\1$/, { timeout: 20_000 });
    await expect(main(page).getByTestId("empty-build")).toBeHidden();
    // Props come off before the motors spin on the bench.
    await main(page)
      .getByRole("button", { name: fill(dronelab.build.remove, { short: "PROPS" }), exact: true })
      .click();
    // exact: "Fit PROPS the wrong way" is offered too once the props are off
    await expect(main(page).getByRole("button", { name: fill(dronelab.build.fit, { short: "PROPS" }), exact: true })).toBeVisible();

    await tab(page, dronelab.workspace.tabs.tests).click();
    // quad5's four: smoke stopper, motor direction (props off), accelerometer calibration, and its own failsafe test.
    const rows = main(page).locator("[data-test]");
    await expect(rows).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const row = rows.nth(i);
      await row.getByRole("button").click();
      await expect(row).toHaveAttribute("data-status", "passed", { timeout: 20_000 });
    }
    await expect(main(page).getByTestId("tests-count")).toHaveText(/^Tests (\d+)\/\1$/);
    await expect(main(page).getByTestId("figure-log")).toContainText("smoke stopper");
  });

  test("the Betaflight CLI answers with real syntax and errors", async ({ page }) => {
    await openWorkshop(page);
    await tab(page, dronelab.workspace.tabs.cli).click();
    const input = main(page).getByTestId("cli-input");
    const output = main(page).getByTestId("cli-output");
    await input.fill("set motor_poles = 12");
    await input.press("Enter");
    await expect(output).toContainText("motor_poles set to 12");
    await input.fill("get motor_poles");
    await input.press("Enter");
    await expect(output).toContainText("Allowed range: 4 - 255");
    await input.fill("set p_level = 50");
    await input.press("Enter");
    await expect(output).toContainText("###ERROR IN set: INVALID NAME: p_level###");
    // Up recalls the last command.
    await input.press("ArrowUp");
    await expect(input).toHaveValue("set p_level = 50");
    await input.fill("save");
    await input.press("Enter");
    await expect(output).toContainText("# saving");
  });

  test("works from the keyboard and passes axe", async ({ page }) => {
    const errors = watchErrors(page);
    await openWorkshop(page);
    const design = tab(page, dronelab.workspace.tabs.design);
    await design.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, dronelab.workspace.tabs.build)).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, dronelab.workspace.tabs.build)).toBeFocused();
    await page.keyboard.press("?");
    const dialog = page.getByRole("dialog", { name: dronelab.keys.title });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(dronelab.keys.rows.arm);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await tab(page, dronelab.workspace.tabs.design).click();
    await expectNoAxeViolations(page);
    expect(errors).toEqual([]);
  });

  test("opens the fly page and arms with Space", async ({ page }) => {
    const errors = watchErrors(page);
    await openWorkshop(page);
    await main(page).getByTestId("fly-link").click();
    await expect(page).toHaveURL("/en/drones/quad5/fly");
    // all clear, the rules fold to one line that opens
    await main(page).getByRole("button", { name: new RegExp(dronelab.fly.preflight) }).click();
    await expect(main(page).getByTestId("arming-rules")).toBeVisible();
    const range = main(page).locator('iframe[src*="/figures/flight/range.html"]');
    await expect(range).toBeVisible({ timeout: 20_000 });
    await range.click();
    await page.keyboard.press("Space");
    await expect(main(page).getByRole("button", { name: flight.buttons.disarm })).toBeVisible({ timeout: 10_000 });
    expect(errors).toEqual([]);
  });

  test("Escape closes the Controls panel", async ({ page }) => {
    await openWorkshop(page);
    await main(page).getByTestId("fly-link").click();
    const controls = main(page).getByRole("button", { name: flight.buttons.legend, exact: true });
    await controls.click();
    await expect(main(page).getByRole("heading", { name: flight.legend.title })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(main(page).getByRole("heading", { name: flight.legend.title })).toBeHidden();
  });
});

test("X, T and L still toggle after a click on the figure", async ({ page }) => {
  await openWorkshop(page);
  await main(page).getByRole("button", { name: /Build it for me/ }).click();
  await expect(main(page).getByTestId("bench-status")).toContainText(/(\d+)\/\1/, { timeout: 20_000 });
  await main(page).locator('iframe[src*="/figures/drones/quad5.html"]').click();
  const toggle = (name: string) => main(page).getByRole("button", { name, exact: true });
  for (const [key, name] of [["x", dronelab.workspace.exploded], ["t", dronelab.workspace.seeThrough]] as const) {
    await page.keyboard.press(key);
    await expect(toggle(name)).toHaveAttribute("aria-pressed", "true");
  }
  await page.keyboard.press("l");
  await expect(toggle(dronelab.workspace.labels)).toHaveAttribute("aria-pressed", "false");
});

test("the Built note stays clear of the part pickers", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/en/drones/gpscam");
  await expect(main(page).getByTestId("bench-status")).toContainText(/\d+\/\d+/, { timeout: 20_000 });
  const frame = page.frames().find((f) => f.url().includes("/figures/drones/gpscam.html"))!;
  await main(page).getByRole("button", { name: /Build it for me/ }).click();
  await expect(frame.locator("#toast.show")).toBeVisible({ timeout: 20_000 });
  const clash = await frame.evaluate(() => {
    const note = document.querySelector("#toast")!.getBoundingClientRect();
    return [...document.querySelectorAll("#btns .act")]
      .filter((b) => b.getClientRects().length > 0)
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.left < note.right && note.left < r.right && r.top < note.bottom && note.top < r.bottom;
      })
      .map((b) => b.textContent?.trim());
  });
  expect(clash).toEqual([]);
});

// the dense builds put a dozen pills close together: none may sit on another or leave the frame, on the surface or see through
for (const id of ["agrihex", "delivery", "gpscam", "longrange", "octo", "tricopter"]) {
  test(`${id}: the labels do not overlap or leave the frame`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/en/drones/${id}`);
    await expect(main(page).getByTestId("bench-status")).toContainText(/\d+\/\d+/, { timeout: 20_000 });
    await main(page).getByRole("button", { name: /Build it for me/ }).click();
    await expect(main(page).getByTestId("bench-status")).toContainText(/(\d+)\/\1/, { timeout: 20_000 });
    const frame = page.frames().find((f) => f.url().includes(`/figures/drones/${id}.html`))!;
    for (const seeThrough of [false, true]) {
      if (seeThrough) await main(page).getByRole("button", { name: dronelab.workspace.seeThrough, exact: true }).click();
      await page.waitForTimeout(1500);
      const bad = await frame.evaluate(() => {
        const frameBox = document.querySelector(".zwrap")!.getBoundingClientRect();
        const pills = [...document.querySelectorAll("#fig g.tag")]
          .filter((g) => getComputedStyle(g).display !== "none")
          .map((g) => ({ name: g.getAttribute("data-en"), box: g.querySelector("rect")!.getBoundingClientRect() }));
        const out = pills.filter(({ box }) => box.left < frameBox.left - 0.5 || box.right > frameBox.right + 0.5 || box.top < frameBox.top - 0.5 || box.bottom > frameBox.bottom + 0.5).map((p) => `${p.name} leaves the frame`);
        for (const [i, a] of pills.entries())
          for (const b of pills.slice(i + 1))
            if (a.box.left < b.box.right - 1 && b.box.left < a.box.right - 1 && a.box.top < b.box.bottom - 1 && b.box.top < a.box.bottom - 1) out.push(`${a.name} on ${b.name}`);
        return out;
      });
      expect(bad, seeThrough ? "see through" : "surface").toEqual([]);
    }
  });
}

test("the index cards line up row by row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/en/drones");
  const cards = main(page).locator("ul > li > article");
  await expect(cards).toHaveCount(13);
  // the chips and the numbers start at the same height on every card of a row, so a two-line title (Agrihex) moves
  // its whole row down instead of leaving a gap under the other cards' chips
  const rows = await cards.evaluateAll((list) => {
    const byRow = new Map<number, string[]>();
    for (const card of list) {
      const top = Math.round(card.getBoundingClientRect().top);
      const at = (sel: string) => Math.round(card.querySelector(sel)!.getBoundingClientRect().top);
      byRow.set(top, [...(byRow.get(top) ?? []), `${at("ul")}:${at("dl")}`]);
    }
    return [...byRow.values()].map((tops) => new Set(tops).size);
  });
  expect(rows).toEqual(rows.map(() => 1));
});

test("Exploded view is a pressed button, as on the board page", async ({ page }) => {
  await openWorkshop(page);
  const exploded = main(page).getByRole("button", { name: dronelab.workspace.exploded, exact: true });
  await expect(exploded).toHaveAttribute("aria-pressed", "false");
  await exploded.click();
  await expect(exploded).toHaveAttribute("aria-pressed", "true");
});

// German labels are the longest: there the readouts take a line of their own rather than being cut
for (const { lang, fault } of [
  { lang: "en", fault: dronelab.workspace.status.fault },
  { lang: "de", fault: "Fehler" },
]) {
  test(`the toolbar's readouts are whole (${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${lang}/drones/quad5`);
    const status = page.locator(`main#main-${lang}`).getByTestId("bench-status");
    await expect(status).toContainText(/\d+\/\d+/, { timeout: 20_000 });
    await expect(status).toContainText(fault);
    const cut = await status.locator("dt, dd").evaluateAll((cells) =>
      cells
        .filter((c) => {
          const r = c.getBoundingClientRect();
          const stage = c.closest("[data-testid=bench-status]")!.parentElement!.parentElement!.getBoundingClientRect();
          return r.width === 0 || c.scrollWidth > c.clientWidth + 1 || r.right > stage.right + 1;
        })
        .map((c) => c.textContent),
    );
    expect(cut).toEqual([]);
  });
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the empty-mat card leaves the figure's own buttons clear", async ({ page }) => {
    await openWorkshop(page);
    const card = main(page).getByTestId("empty-build").locator("xpath=ancestor::div[contains(@class,'pointer-events-auto')][1]");
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    const frame = page.frames().find((f) => f.url().includes("/figures/drones/quad5.html"))!;
    const iframe = (await main(page).locator('iframe[src*="/figures/drones/quad5.html"]').boundingBox())!;
    const buttons = await frame.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => b.getClientRects().length > 0 && getComputedStyle(b).visibility !== "hidden")
        .map((b) => ({ name: b.textContent?.trim(), ...b.getBoundingClientRect().toJSON() })),
    );
    expect(buttons.length).toBeGreaterThan(0);
    const under = buttons.filter(
      (b) => b.top + iframe.y < box!.y + box!.height && b.bottom + iframe.y > box!.y && b.left + iframe.x < box!.x + box!.width && b.right + iframe.x > box!.x,
    );
    expect(under.map((b) => b.name)).toEqual([]);
  });
});
