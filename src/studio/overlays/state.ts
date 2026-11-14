import type { Messages } from "../../i18n/namespaces.ts";
import { PIN_RADIUS_MM } from "../engine/constants.ts";
import type { PartVisualState, PinLevel } from "../engine/part-state.ts";
import type { ArtElement, Overlay, RectMm, Scene } from "../engine/types.ts";

export type StateLabels = Messages["studioRun"]["overlay"];

const GLOW = "var(--studio-wire-yellow)";
const INK = "var(--studio-ink)";
const PAPER = "var(--studio-paper)";
const WARN = "var(--studio-warn)";
const TAG_SIZE_MM = 2;
const TAG_GAP_MM = 1.2;
const GLOW_GAP_MM = 1.5;
const GLOW_MIN_SW = 0.4;
const GLOW_SPAN_SW = 1.2;
const HALO_GAP_MM = 1.5;
const HALO_SW = 0.3;
const MARK_PAD_MM = 0.8;
const MARK_SW = 0.4;
const BADGE_MM = 2.4;
const BADGE_TEXT_MM = 1.8;
const BADGE_OFFSET_MM = PIN_RADIUS_MM + 0.6;
const ARM_SW = 0.7;
const ARM_PIVOT_MM = 0.9;
const ARM_REACH_MM = 1.5;
const DIAL_SW = 0.2;
const SPIN_SW = 0.5;
const SPIN_SWEEP = (300 * Math.PI) / 180;
const HEAD_MM = 1.2;

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

const percent = (n: number): string => String(Math.round(n * 100));

const DEG = Math.PI / 180;

/** A servo's arm angle is 0 pointing left, 90 up and 180 right, like the horn on a bench servo seen from above. */
const servoDir = (deg: number) => ({ x: -Math.cos(deg * DEG), y: -Math.sin(deg * DEG) });

/** A stepper shaft mark is 0 pointing up and turns clockwise. */
const shaftDir = (deg: number) => ({ x: Math.sin(deg * DEG), y: -Math.cos(deg * DEG) });

const num = (n: number): string => String(Math.round(n * 100) / 100);

const reach = (box: RectMm): number => Math.max(box.x1 - box.x0, box.y1 - box.y0) / 2 + ARM_REACH_MM;

function armOf(dir: { x: number; y: number }, r: number, stroke: string): ArtElement[] {
  return [
    { t: "path", d: `M 0 0 L ${num(dir.x * r)} ${num(dir.y * r)}`, stroke, sw: ARM_SW },
    { t: "circle", cx: 0, cy: 0, r: ARM_PIVOT_MM, fill: PAPER, stroke, sw: MARK_SW },
  ];
}

function servoMark(box: RectMm, state: Extract<PartVisualState, { kind: "servo" }>): ArtElement[] {
  const r = reach(box);
  const stroke = state.powered ? INK : WARN;
  const dial: ArtElement = { t: "path", d: `M ${num(-r)} 0 A ${num(r)} ${num(r)} 0 0 1 ${num(r)} 0`, fill: "none", stroke: INK, sw: DIAL_SW };
  return [dial, ...armOf(servoDir(state.angle), r, stroke)];
}

function stepperMark(box: RectMm, state: Extract<PartVisualState, { kind: "stepper" }>): ArtElement[] {
  const r = reach(box);
  const ring: ArtElement = { t: "circle", cx: 0, cy: 0, r, fill: "none", stroke: INK, sw: DIAL_SW };
  return [ring, ...armOf(shaftDir(state.angle), r, state.powered ? INK : WARN)];
}

/** An arc with an arrow head at its end: clockwise for a positive speed, counter-clockwise for a negative one. A stalled motor gets a closed ring. */
function spinMark(box: RectMm, state: Extract<PartVisualState, { kind: "motor" }>): ArtElement[] {
  const r = reach(box);
  if (!state.powered) return [];
  if (state.stalled) return [{ t: "circle", cx: 0, cy: 0, r, fill: "none", stroke: WARN, sw: SPIN_SW }];
  const sign = state.rpm < 0 ? -1 : 1;
  const start = -Math.PI / 2;
  const end = start + sign * SPIN_SWEEP;
  const at = (a: number) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
  const [from, to] = [at(start), at(end)];
  const tangent = { x: -sign * Math.sin(end), y: sign * Math.cos(end) };
  const normal = { x: -tangent.y, y: tangent.x };
  const back = (side: number) => `${num(to.x - tangent.x * HEAD_MM + normal.x * HEAD_MM * side)} ${num(to.y - tangent.y * HEAD_MM + normal.y * HEAD_MM * side)}`;
  const arc = `M ${num(from.x)} ${num(from.y)} A ${num(r)} ${num(r)} 0 1 ${sign > 0 ? 1 : 0} ${num(to.x)} ${num(to.y)}`;
  return [
    { t: "path", d: arc, fill: "none", stroke: INK, sw: SPIN_SW },
    { t: "path", d: `M ${back(1)} L ${num(to.x)} ${num(to.y)} L ${back(-1)}`, fill: "none", stroke: INK, sw: SPIN_SW },
  ];
}

/** Where the glass sits on a display module, as shares of the part's box: the 0.96 inch panel is twice as wide as tall. */
const SCREEN = { x: 0.12, w: 0.8 };
/** Adafruit_GFX text: 6 x 8 pixel cells per text size; a monospace face at 10 pixels a size steps 6 pixels a letter. */
const GLYPH_STEP_PX = 10;
const GLYPH_BASE_PX = 7;

/** The panel as the program left it: lit pixels as one path of row runs, and the printed text runs over them. */
function screenOf(box: RectMm, state: Extract<PartVisualState, { kind: "display" }>): ArtElement[] {
  const bw = box.x1 - box.x0;
  const w = bw * SCREEN.w;
  const px = w / state.w;
  const h = px * state.h;
  const x0 = box.x0 + bw * SCREEN.x - (box.x0 + box.x1) / 2;
  const y0 = -h / 2;
  const [glass, lit] = state.inverted ? [PAPER, INK] : [INK, PAPER];
  const out: ArtElement[] = [{ t: "rect", x: x0, y: y0, w, h, rx: 0.3, fill: glass }];
  if (!state.on) return out;
  let d = "";
  state.rows.forEach((row, y) => {
    let run = -1;
    for (let x = 0; x <= state.w; x++) {
      const on = x < state.w && ((parseInt(row[x >> 2] ?? "0", 16) >> (3 - (x & 3))) & 1) === 1;
      if (on && run < 0) run = x;
      if (!on && run >= 0) {
        d += `M ${num(x0 + run * px)} ${num(y0 + y * px)} h ${num((x - run) * px)} v ${num(px)} h ${num(-(x - run) * px)} Z `;
        run = -1;
      }
    }
  });
  if (d) out.push({ t: "path", d: d.trim(), fill: lit });
  for (const t of state.texts) {
    out.push({ t: "text", x: x0 + t.x * px, y: y0 + (t.y + GLYPH_BASE_PX * t.size) * px, s: t.text, size: GLYPH_STEP_PX * t.size * px, anchor: "start", fill: lit });
  }
  return out;
}

/** Three significant digits, so 23.4 stays 23.4 and 4.98 stays 4.98. */
const readable = (n: number): string => String(Number(n.toPrecision(3)));

function tagOf(state: PartVisualState, labels: StateLabels): string {
  switch (state.kind) {
    case "led":
      if (!state.on) return labels.off;
      if (state.lamps?.length) return `${state.lamps.join(" ")} ${labels.on}`;
      return state.duty < 1 ? fill(labels.duty, { percent: percent(state.duty) }) : labels.on;
    case "button":
      return state.pressed ? labels.pressed : labels.released;
    case "pot":
      return fill(labels.position, { percent: percent(state.position) });
    case "buzzer":
      return state.tone === null ? labels.silent : fill(labels.tone, { hz: String(Math.round(state.tone)) });
    case "servo":
      return state.powered ? fill(labels.servo, { deg: String(Math.round(state.angle)) }) : labels.unpowered;
    case "motor":
      if (!state.powered) return labels.unpowered;
      return state.stalled ? labels.stalled : fill(labels.motor, { rpm: String(Math.round(state.rpm)) });
    case "stepper":
      return state.powered ? fill(labels.stepper, { deg: String(Math.round(state.angle)), steps: String(Math.round(state.steps)) }) : labels.unpowered;
    case "reading":
      return fill(labels.reading, { label: state.label, value: readable(state.value), unit: state.unit }).trim().replace(/\s+/g, " ");
    case "display":
      return "";
    case "none":
      return labels.notModelled;
  }
}

function glowOf(box: RectMm, duty: number, reduceMotion: boolean): ArtElement[] {
  const r = Math.max(box.x1 - box.x0, box.y1 - box.y0) / 2 + GLOW_GAP_MM;
  const ring: ArtElement = { t: "circle", cx: 0, cy: 0, r, fill: "none", stroke: GLOW, sw: GLOW_MIN_SW + GLOW_SPAN_SW * duty };
  if (reduceMotion) return [ring];
  return [{ t: "circle", cx: 0, cy: 0, r: r + HALO_GAP_MM, fill: "none", stroke: GLOW, sw: HALO_SW }, ring];
}

/**
 * The live layer of a run: a glow and a text tag for each lit LED, an arm at its angle for a servo, a shaft mark for a
 * stepper, a spin arrow for a running motor, a text tag for every other modelled part, the
 * "not modelled yet" mark on a part with no model, and a 0 or 1 badge on each pin that has a level. Every item
 * carries text, so no state is shown by colour alone. With `reduceMotion` the glow loses its outer halo and keeps
 * the tag. Parts and pins that are not in `scene` (off screen, or in another view) get nothing.
 */
export function stateOverlays(
  scene: Scene,
  states: Map<string, PartVisualState>,
  pinLevels: Map<string, PinLevel>,
  opts: { reduceMotion: boolean; labels: StateLabels },
): Overlay[] {
  const overlays: Overlay[] = [];
  for (const { hit, bbox } of scene.targets) {
    if (hit.kind === "part") {
      const state = states.get(hit.c);
      if (!state) continue;
      const cx = (bbox.x0 + bbox.x1) / 2;
      const elements: ArtElement[] = [];
      if (state.kind === "led" && state.on) elements.push(...glowOf(bbox, state.duty, opts.reduceMotion));
      if (state.kind === "servo") elements.push(...servoMark(bbox, state));
      if (state.kind === "stepper") elements.push(...stepperMark(bbox, state));
      if (state.kind === "motor") elements.push(...spinMark(bbox, state));
      if (state.kind === "display") elements.push(...screenOf(bbox, state));
      if (state.kind === "none") {
        elements.push({
          t: "rect",
          x: bbox.x0 - cx - MARK_PAD_MM,
          y: -(bbox.y1 - bbox.y0) / 2 - MARK_PAD_MM,
          w: bbox.x1 - bbox.x0 + 2 * MARK_PAD_MM,
          h: bbox.y1 - bbox.y0 + 2 * MARK_PAD_MM,
          rx: MARK_PAD_MM,
          fill: "none",
          stroke: WARN,
          sw: MARK_SW,
        });
      }
      const ringed = state.kind === "motor" || state.kind === "stepper";
      const half = ringed ? reach(bbox) : (bbox.y1 - bbox.y0) / 2;
      const below = half + TAG_GAP_MM + (state.kind === "led" && state.on ? GLOW_GAP_MM : 0) + TAG_SIZE_MM;
      const tag = tagOf(state, opts.labels);
      if (tag) elements.push({ t: "text", x: 0, y: below, s: tag, size: TAG_SIZE_MM, anchor: "middle", legible: "down" });
      overlays.push({ id: `state:${hit.c}`, xMm: cx, yMm: (bbox.y0 + bbox.y1) / 2, elements });
    } else if (hit.kind === "pin") {
      const level = pinLevels.get(`${hit.c}/${hit.p}`);
      if (level === undefined || level === null) continue;
      overlays.push({
        id: `level:${hit.c}/${hit.p}`,
        xMm: (bbox.x0 + bbox.x1) / 2,
        yMm: (bbox.y0 + bbox.y1) / 2,
        elements: [
          { t: "rect", x: BADGE_OFFSET_MM, y: -BADGE_OFFSET_MM - BADGE_MM, w: BADGE_MM, h: BADGE_MM, rx: 0.5, fill: PAPER, stroke: INK, sw: 0.2 },
          { t: "text", x: BADGE_OFFSET_MM + BADGE_MM / 2, y: -BADGE_OFFSET_MM - (BADGE_MM - BADGE_TEXT_MM) / 2 - 0.2, s: String(level), size: BADGE_TEXT_MM, anchor: "middle" },
        ],
      });
    }
  }
  return overlays;
}
