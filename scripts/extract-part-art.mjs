// Flat editor art for the core parts, cut from their figure pages: the Studio draws it in Illustrated mode at the
// closest zoom (src/studio/art/figure-art.ts). The pages are isometric; the art is taken as the page draws it (or from
// straight above, for a long flat module the isometric view would leave mostly empty), less the stand it sits on, scaled
// to fit the descriptor's body in millimetres, with the paint kept as palette variables where the page uses a palette
// colour. The boards are drawn by hand in src/studio/art/boards.ts. Re-run it after a figure page changes (the data test flags a stale extract by the page's hash):
//   node scripts/extract-part-art.mjs [--out <dir>] [--check]
// --out writes art-data.ts to another folder (default src/studio/art/data). --check regenerates in memory and exits 1
// when the committed file differs.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_ELEMENTS = 150;

const SOURCES = {
  led: { page: "parts/led.html", descriptor: "led-5mm", view: "iso" },
  resistor: { page: "parts/resistor.html", descriptor: "resistor", view: "iso" },
  "push-button": { page: "parts/push-button.html", descriptor: "push-button-6mm", view: "iso" },
  "piezo-buzzer": { page: "parts/piezo-buzzer.html", descriptor: "buzzer-piezo", view: "iso" },
  potentiometer: { page: "parts/potentiometer.html", descriptor: "potentiometer-10k", view: "iso" },
  "capacitor-ceramic": { page: "parts/capacitor-ceramic.html", descriptor: "capacitor-ceramic", view: "iso" },
  "capacitor-electrolytic": { page: "parts/capacitor-electrolytic.html", descriptor: "capacitor-electrolytic", view: "iso" },
  inductor: { page: "parts/inductor.html", descriptor: "inductor", view: "iso" },
  lm358: { page: "parts/lm358.html", descriptor: "lm358", view: "iso" },
  ne555: { page: "parts/ne555.html", descriptor: "ne555", view: "iso" },
  "zener-1n4733a": { page: "parts/zener-1n4733a.html", descriptor: "zener-1n4733a", view: "iso" },
  "aa-holder-4": { page: "parts/aa-holder-4.html", descriptor: "aa-holder-4", whole: true },
  "dc-motor": { page: "parts/dc-motor.html", descriptor: "dc-motor", whole: true },
  "diode-1n4007": { page: "parts/diode-1n4007.html", descriptor: "diode-1n4007", whole: true, skip: ["D2"] },
  fan: { page: "parts/fan.html", descriptor: "fan", whole: true },
  "hc-sr04": { page: "modules/hc-sr04.html", descriptor: "hc-sr04", whole: true },
  ldr: { page: "parts/ldr.html", descriptor: "ldr", whole: true },
  "lipo-2s": { page: "parts/lipo-2s.html", descriptor: "lipo-2s", whole: true },
  mpu6050: { page: "parts/mpu6050.html", descriptor: "gy521-mpu6050", whole: true },
  multimeter: { page: "parts/multimeter.html", descriptor: "multimeter", view: "iso", whole: true },
  nema17: { page: "parts/nema17.html", descriptor: "nema17", whole: true },
  "npn-2n2222": { page: "parts/npn-2n2222.html", descriptor: "npn-2n2222", view: "iso", whole: true, skip: ["Q2"] },
  "servo-sg90": { page: "parts/servo-sg90.html", descriptor: "servo-sg90", view: "iso", whole: true },
  "soil-moisture": { page: "modules/soil-moisture.html", descriptor: "soil-moisture", whole: true },
  ssd1306: { page: "parts/ssd1306.html", descriptor: "ssd1306", whole: true },
  "stepper-28byj48": { page: "parts/stepper-28byj48.html", descriptor: "stepper-28byj48", whole: true },
  tip120: { page: "parts/tip120.html", descriptor: "tip120", view: "iso", whole: true },
  tmp36: { page: "parts/tmp36.html", descriptor: "tmp36", view: "iso", whole: true },
  "traffic-light": { page: "parts/traffic-light.html", descriptor: "traffic-light", whole: true },
  "tt-motor": { page: "parts/tt-motor.html", descriptor: "tt-motor", whole: true },
  uln2003: { page: "modules/uln2003.html", descriptor: "uln2003-module", whole: true, skip: ["CABLE", "MOTOR"] },
  a4988: { page: "modules/a4988.html", descriptor: "a4988-module", whole: true },
  l298n: { page: "modules/l298n.html", descriptor: "l298n-module", whole: true },
  lm2596: { page: "modules/lm2596.html", descriptor: "lm2596-module", whole: true },
  pca9685: { page: "modules/pca9685.html", descriptor: "pca9685-module", whole: true },
  "qtr-8rc": { page: "modules/qtr-8rc.html", descriptor: "qtr-8rc", whole: true },
  tb6612fng: { page: "modules/tb6612fng.html", descriptor: "tb6612fng-module", whole: true },
};

// The page's palette colours, by the token that holds the same value (src/styles/tokens.css).
const TOKENS = {
  "#ef6a4c": "tomato-l", "#cf5038": "tomato-m", "#4a2219": "tomato-d",
  "#f4b829": "mustard-l", "#d49c1f": "mustard-m", "#4e4a18": "mustard-d",
  "#93d3b0": "mint-l", "#71b693": "mint-m", "#1f4034": "mint-d",
  "#76a0e2": "cobalt-l", "#5a82c6": "cobalt-m", "#1c2948": "cobalt-d",
  "#f3a6bb": "blush-l", "#d8869c": "blush-m", "#4b2430": "blush-d",
  "#eef0f0": "metal-l", "#c6ccce": "metal-m", "#8f989b": "metal-d",
  "#231e16": "ink-fixed",
};

const round = (n) => Math.round(n * 1000) / 1000;

function colour(value) {
  if (!value || value === "none") return undefined;
  const token = TOKENS[value.toLowerCase()];
  return token ? `var(--color-${token})` : value.toLowerCase();
}

// Runs in the page: the drawable shapes of the part, in paint order. Masked, clipped, translucent, gradient-filled and
// styled shapes are left out, and so is every label. By default the shapes come from the page's biggest group; with
// `whole` they come from the whole drawing less the breadboard and the groups named in `skip` (cables, a demo motor),
// for pages that draw one part across many groups or draw a board's PCB outside any group.
function collect({ whole, skip }) {
  const art = document.querySelector("#art");
  const groups = [...art.querySelectorAll("g[data-act]")].filter((g) => g.dataset.id !== "BB");
  const top = whole ? art : groups.sort((a, b) => b.querySelectorAll("path").length - a.querySelectorAll("path").length)[0];
  const left = ["BB", ...skip];
  const attrs = ["d", "x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "fill", "stroke", "stroke-width"];
  const out = [];
  for (const el of top.querySelectorAll("path,circle,rect,ellipse")) {
    if (el.closest("mask,clipPath,defs,.tag") || el.hasAttribute("opacity") || el.hasAttribute("style") || el.hasAttribute("filter")) continue;
    if (whole && left.includes(el.closest("g[data-act]")?.dataset.id)) continue;
    if ((el.getAttribute("fill") ?? "").startsWith("url(") || (el.getAttribute("stroke") ?? "").startsWith("url(")) continue;
    const o = { t: el.tagName, loose: whole && !el.closest("g[data-act]") };
    for (const a of attrs) if (el.hasAttribute(a)) o[a] = el.getAttribute(a);
    out.push(o);
  }
  return out;
}

// The stand a figure page sets its object on is drawn first and ends with the ink outline round the whole slab, the
// biggest loose shape on the page; the cast shadows, on it and in the part's groups, are one flat colour.
const SHADOW = "#41538f";

function withoutStand(found) {
  const area = (e) => (e.x1 - e.x0) * (e.y1 - e.y0);
  let last = -1;
  found.forEach((e, i) => {
    if (e.loose && (last < 0 || area(e) > area(found[last]))) last = i;
  });
  const standFirst = last >= 0 && found.slice(0, last + 1).every((e) => e.loose);
  return found.filter((e, i) => !(standFirst && i <= last) && (e.fill ?? "").toLowerCase() !== SHADOW);
}

function pathPoints(d) {
  const nums = d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
}

function extent(e) {
  const n = (k) => Number(e[k] ?? 0);
  switch (e.t) {
    case "path": {
      const pts = pathPoints(e.d);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    case "rect":
      return { x0: n("x"), y0: n("y"), x1: n("x") + n("width"), y1: n("y") + n("height") };
    case "circle":
      return { x0: n("cx") - n("r"), y0: n("cy") - n("r"), x1: n("cx") + n("r"), y1: n("cy") + n("r") };
    default:
      return { x0: n("cx") - n("rx"), y0: n("cy") - n("ry"), x1: n("cx") + n("rx"), y1: n("cy") + n("ry") };
  }
}

function scaledPath(d, k, ox, oy) {
  let i = 0;
  return d.replace(/-?\d*\.?\d+(?:e-?\d+)?/gi, (m) => round(Number(m) * k + (i++ % 2 === 0 ? ox : oy)));
}

function toElement(e, k, ox, oy) {
  const n = (key) => Number(e[key] ?? 0);
  const paint = {};
  const fill = colour(e.fill);
  const stroke = colour(e.stroke);
  if (fill) paint.fill = fill;
  if (stroke) {
    paint.stroke = stroke;
    paint.sw = round(n("stroke-width") * k);
  }
  switch (e.t) {
    case "path":
      return { t: "path", d: scaledPath(e.d, k, ox, oy), ...paint };
    case "rect": {
      const el = { t: "rect", x: round(n("x") * k + ox), y: round(n("y") * k + oy), w: round(n("width") * k), h: round(n("height") * k) };
      if (e.rx) el.rx = round(n("rx") * k);
      return { ...el, ...paint };
    }
    case "circle":
      return { t: "circle", cx: round(n("cx") * k + ox), cy: round(n("cy") * k + oy), r: round(n("r") * k), ...paint };
    default:
      return { t: "ellipse", cx: round(n("cx") * k + ox), cy: round(n("cy") * k + oy), rx: round(n("rx") * k), ry: round(n("ry") * k), ...paint };
  }
}

const samePaint = (a, b) => a.fill === b.fill && a.stroke === b.stroke && a.sw === b.sw;

// Neighbouring paths with one paint draw as one, which keeps the paint order.
function merge(elements) {
  const out = [];
  for (const e of elements) {
    const last = out[out.length - 1];
    if (e.t === "path" && last?.t === "path" && samePaint(last, e)) out[out.length - 1] = { ...last, d: `${last.d} ${e.d}` };
    else out.push(e);
  }
  return out;
}

const weight = (e) => {
  const w = e.x1 - e.x0;
  const h = e.y1 - e.y0;
  return w * h + (w + h) * Number(e["stroke-width"] ?? 0);
};

// Drops the smallest shapes until the merged art fits the budget.
function thin(raw) {
  const sizes = [...new Set(raw.map(weight))].sort((a, b) => a - b);
  let lo = 0;
  let hi = sizes.length - 1;
  const fits = (min) => merge(raw.filter((e) => weight(e) >= min).map((e) => toElement(e, 1, 0, 0))).length <= MAX_ELEMENTS;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fits(sizes[mid])) hi = mid;
    else lo = mid + 1;
  }
  return raw.filter((e) => weight(e) >= sizes[lo]);
}

function bodyOf(descriptor) {
  const file = join(root, "src/parts/data", `${descriptor}.component.json`);
  return JSON.parse(readFileSync(file, "utf8")).dimensions.body;
}

const TOP_PITCH = 78;
const KEEP_ISO = 0.55;

async function shapesAt(page, file, view, source) {
  const query = view ? `&yaw=${view.yaw}&pitch=${TOP_PITCH}` : "";
  await page.goto(`${pathToFileURL(file).href}?bare=1${query}`);
  await page.waitForFunction(() => document.querySelector("#art")?.childElementCount > 1);
  const found = await page.evaluate(collect, { whole: source.whole === true, skip: source.skip ?? [] });
  return thin(withoutStand(found.map((e) => ({ ...e, ...extent(e) }))));
}

const boxOf = (kept) =>
  kept.reduce(
    (b, e) => ({ x0: Math.min(b.x0, e.x0), y0: Math.min(b.y0, e.y0), x1: Math.max(b.x1, e.x1), y1: Math.max(b.y1, e.y1) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );

// How much of the body the art covers when fitted into it.
function coverage(box, body) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const k = Math.min(body.w / w, body.h / h);
  return (w * k * h * k) / (body.w * body.h);
}

// The isometric view, unless it leaves the body mostly empty (long flat modules): then the nearest top-down view.
async function pickView(page, file, body, source) {
  const forced = source.view;
  if (forced) return { view: forced === "iso" ? null : forced, kept: await shapesAt(page, file, forced === "iso" ? null : forced, source) };
  const iso = await shapesAt(page, file, null, source);
  if (coverage(boxOf(iso), body) >= KEEP_ISO) return { view: null, kept: iso };
  let best = { view: null, kept: iso, score: coverage(boxOf(iso), body) };
  for (const yaw of [0, 90, 180, 270]) {
    const kept = await shapesAt(page, file, { yaw }, source);
    const score = coverage(boxOf(kept), body) - (yaw === 0 ? 0 : 0.001);
    if (score > best.score) best = { view: { yaw }, kept, score };
  }
  return best;
}

async function extractOne(page, source) {
  const file = join(root, "public/figures", source.page);
  const body = bodyOf(source.descriptor);
  const { view, kept } = await pickView(page, file, body, source);
  const box = boxOf(kept);
  const k = Math.min(body.w / (box.x1 - box.x0), body.h / (box.y1 - box.y0));
  const ox = (body.w - (box.x1 - box.x0) * k) / 2 - box.x0 * k;
  const oy = (body.h - (box.y1 - box.y0) * k) / 2 - box.y0 * k;
  console.log(`${source.descriptor}: ${view ? `top-down yaw ${view.yaw}` : "isometric"}`);
  return {
    viewBox: `0 0 ${body.w} ${body.h}`,
    sourceSha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    elements: merge(kept.map((e) => toElement(e, k, ox, oy))),
  };
}

const HEADER = `// Generated by scripts/extract-part-art.mjs from the figure pages in public/figures. Do not edit by hand.
// Re-run: node scripts/extract-part-art.mjs
import type { ArtElement } from "../../engine/types.ts";

export const ART_DATA: Readonly<Record<string, { viewBox: string; sourceSha256: string; elements: readonly ArtElement[] }>> = {
`;

function render(data) {
  const entries = Object.entries(data).map(([id, a]) => {
    const lines = a.elements.map((e) => `      ${JSON.stringify(e)},`).join("\n");
    return `  ${JSON.stringify(id)}: {\n    viewBox: ${JSON.stringify(a.viewBox)},\n    sourceSha256: ${JSON.stringify(a.sourceSha256)},\n    elements: [\n${lines}\n    ],\n  },\n`;
  });
  return `${HEADER}${entries.join("")}};\n`;
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const outIndex = args.indexOf("--out");
const outDir = resolve(root, outIndex >= 0 ? args[outIndex + 1] : "src/studio/art/data");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const data = {};
  for (const [id, source] of Object.entries(SOURCES)) {
    data[id] = await extractOne(page, source);
    console.log(`${id}: ${data[id].elements.length} elements`);
  }
  const text = render(data);
  const target = join(outDir, "art-data.ts");
  if (check) {
    let current = "";
    try {
      current = readFileSync(target, "utf8");
    } catch {}
    if (current !== text) {
      console.error(`${target} is out of date: run node scripts/extract-part-art.mjs`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(target, text);
  }
} finally {
  await browser.close();
}
