// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import en from "../../i18n/messages/en/studioRun.json" with { type: "json" };
import { builtinRegistry } from "../../parts/builtin.ts";
import { buildDrawList } from "../engine/draw-list.ts";
import { derivePartStates, pinLevels } from "../engine/part-state.ts";
import type { PartVisualState } from "../engine/part-state.ts";
import type { ArtProvider, Overlay, ResolvedPartShape, Scene } from "../engine/types.ts";
import type { PartStateFrame } from "../stores/run.ts";
import { netlist } from "../../project/netlist.ts";
import { blinkCircuit } from "../testing/blink-circuit.ts";
import type { BlinkCircuit } from "../testing/blink-circuit.ts";
import { stateOverlays } from "./state.ts";

const registry = builtinRegistry();
const art: ArtProvider = { get: () => [] };
const labels = en.overlay;

function resolve(defRef: string): ResolvedPartShape {
  const d = registry.latest(defRef)!;
  const h = d.dimensions?.body?.h ?? 1;
  return {
    widthMm: d.dimensions?.body?.w ?? 1,
    heightMm: h,
    known: true,
    pins: d.pins.map((p) => ({ id: p.id, xMm: p.position?.x ?? 0, yMm: h - (p.position?.y ?? 0), mechanical: p.type === "mechanical" })),
  };
}

let circuit: BlinkCircuit;
let scene: Scene;
let d13: string;

beforeAll(() => {
  circuit = blinkCircuit();
  d13 = netlist(circuit.project).pinNode["brd_uno/D13"]!;
  scene = buildDrawList({
    state: circuit.project,
    viewId: "vw_bb",
    viewport: { cx_mm: 0, cy_mm: 20, k: 6, w: 1400, h: 800, dpr: 1 },
    art,
    resolve,
    index: null,
    prev: null,
    mode: "illustrated",
    overlays: [],
  }).scene;
});

function run(frame: PartStateFrame, reduceMotion = false): Overlay[] {
  return stateOverlays(scene, derivePartStates(circuit.project, frame), pinLevels(circuit.project, frame), { reduceMotion, labels });
}

const texts = (o: Overlay): string[] => o.elements.flatMap((e) => (e.t === "text" ? [e.s] : []));
const frameOf = (level: 0 | 1): PartStateFrame => ({ tNs: 1, pins: { [d13]: level }, parts: [] });

describe("stateOverlays", () => {
  it("glows a lit LED and tags it on, and tags it off when the pin is low", () => {
    const lit = run(frameOf(1)).find((o) => o.id === `state:${circuit.led}`)!;
    expect(texts(lit)).toEqual(["on"]);
    expect(lit.elements.some((e) => e.t === "circle")).toBe(true);
    const dark = run(frameOf(0)).find((o) => o.id === `state:${circuit.led}`)!;
    expect(texts(dark)).toEqual(["off"]);
    expect(dark.elements.some((e) => e.t === "circle")).toBe(false);
  });

  it("tags PWM duty as a percentage", () => {
    const frame: PartStateFrame = { tNs: 1, pins: {}, parts: [{ part: circuit.led, kind: "led", lit: true, brightness: 0.4 }] };
    expect(texts(run(frame).find((o) => o.id === `state:${circuit.led}`)!)).toEqual(["duty 40%"]);
  });

  it("tags a pressed button", () => {
    const frame: PartStateFrame = { tNs: 1, pins: {}, parts: [{ part: circuit.button, kind: "button", pressed: true }] };
    expect(texts(run(frame).find((o) => o.id === `state:${circuit.button}`)!)).toEqual(["pressed"]);
  });

  it("puts the not modelled yet mark on a part with no model", () => {
    const states = new Map<string, PartVisualState>([[circuit.led, { kind: "none", reason: "not-modelled-yet" }]]);
    const [mark] = stateOverlays(scene, states, new Map(), { reduceMotion: false, labels }).filter((o) => o.id.startsWith("state:"));
    expect(texts(mark!)).toEqual(["not modelled yet"]);
    expect(mark!.elements.some((e) => e.t === "rect")).toBe(true);
  });

  it("draws an OLED's glass, its lit pixels as row runs and its text, with no tag", () => {
    const display = (on: boolean, inverted = false): PartVisualState => ({
      kind: "display",
      w: 8,
      h: 2,
      on,
      inverted,
      rows: ["f0", "81"],
      texts: [{ x: 0, y: 0, size: 1, text: "Hi" }],
    });
    const draw = (state: PartVisualState) =>
      stateOverlays(scene, new Map([[circuit.led, state]]), new Map(), { reduceMotion: false, labels }).find((o) => o.id === `state:${circuit.led}`)!;
    const lit = draw(display(true));
    expect(texts(lit)).toEqual(["Hi"]);
    const [glass] = lit.elements.filter((e) => e.t === "rect");
    const pixels = lit.elements.find((e) => e.t === "path");
    // row 0 is one run of four pixels, row 1 two single pixels at each end
    expect(pixels && pixels.t === "path" ? pixels.d.match(/M /g)?.length : 0).toBe(3);
    expect(glass && glass.t === "rect" ? glass.fill : "").not.toBe(pixels && pixels.t === "path" ? pixels.fill : "");
    const off = draw(display(false));
    expect(texts(off)).toEqual([]);
    expect(off.elements.some((e) => e.t === "path")).toBe(false);
    const flipped = draw(display(true, true));
    const flippedGlass = flipped.elements.find((e) => e.t === "rect");
    expect(flippedGlass && flippedGlass.t === "rect" ? flippedGlass.fill : "").toBe(pixels && pixels.t === "path" ? pixels.fill : "");
  });

  it("badges driven pins with their level and skips pins without one", () => {
    const badges = run(frameOf(1)).filter((o) => o.id.startsWith("level:"));
    const ids = badges.map((o) => o.id);
    expect(ids).toEqual(["level:brd_uno/D13", "level:brd_uno/ICSP_3", `level:${circuit.r1}/P1`]);
    expect(badges.flatMap(texts)).toEqual(["1", "1", "1"]);
  });

  it("gives every item a text tag", () => {
    for (const level of [0, 1] as const) {
      const overlays = run(frameOf(level));
      expect(overlays.length).toBeGreaterThan(0);
      for (const o of overlays) expect(texts(o).length, o.id).toBeGreaterThan(0);
    }
  });

  it("drops the glow halo under reduced motion and keeps the tag", () => {
    const find = (o: Overlay[]) => o.find((x) => x.id === `state:${circuit.led}`)!;
    const calm = find(run(frameOf(1), true));
    const lively = find(run(frameOf(1), false));
    expect(calm.elements.filter((e) => e.t === "circle")).toHaveLength(1);
    expect(lively.elements.filter((e) => e.t === "circle")).toHaveLength(2);
    expect(texts(calm)).toEqual(["on"]);
  });

  it("draws nothing for a part that is not in the scene", () => {
    const states = new Map<string, PartVisualState>([["cmp_gone", { kind: "button", pressed: true }]]);
    expect(stateOverlays(scene, states, new Map(), { reduceMotion: false, labels })).toEqual([]);
  });

  describe("actuators and readings", () => {
    const at = (state: PartVisualState): Overlay => {
      const states = new Map<string, PartVisualState>([[circuit.led, state]]);
      return stateOverlays(scene, states, new Map(), { reduceMotion: false, labels }).find((o) => o.id === `state:${circuit.led}`)!;
    };
    const paths = (o: Overlay) => o.elements.flatMap((e) => (e.t === "path" ? [e.d] : []));
    const arm = (o: Overlay): { x: number; y: number } => {
      const m = /^M 0 0 L (-?[\d.]+) (-?[\d.]+)$/.exec(paths(o).find((d) => d.startsWith("M 0 0 L"))!)!;
      return { x: Number(m[1]), y: Number(m[2]) };
    };

    it("draws the servo arm at its angle and tags the degrees", () => {
      const left = at({ kind: "servo", angle: 0, powered: true });
      const up = at({ kind: "servo", angle: 90, powered: true });
      const right = at({ kind: "servo", angle: 180, powered: true });
      expect(texts(up)).toEqual(["90°"]);
      expect(arm(left).x).toBeLessThan(-1);
      expect(Math.abs(arm(left).y)).toBeLessThan(0.01);
      expect(arm(up).y).toBeLessThan(-1);
      expect(Math.abs(arm(up).x)).toBeLessThan(0.01);
      expect(arm(right).x).toBeGreaterThan(1);
    });

    it("tags an unpowered servo as having no power and draws its arm in the warning colour", () => {
      const off = at({ kind: "servo", angle: 90, powered: false });
      expect(texts(off)).toEqual(["no power"]);
      expect(off.elements.some((e) => e.t === "path" && e.stroke === "var(--studio-warn)")).toBe(true);
    });

    it("draws a spin arrow for a running motor, flipped for the other direction, with the rpm in the tag", () => {
      const cw = at({ kind: "motor", rpm: 3200, stalled: false, powered: true });
      const ccw = at({ kind: "motor", rpm: -3200, stalled: false, powered: true });
      expect(texts(cw)).toEqual(["3200 rpm"]);
      expect(texts(ccw)).toEqual(["-3200 rpm"]);
      expect(paths(cw)[0]).toMatch(/ 0 1 1 /);
      expect(paths(ccw)[0]).toMatch(/ 0 1 0 /);
      expect(paths(cw)).toHaveLength(2);
    });

    it("rings a stalled motor, says so, and draws nothing for one with no power", () => {
      const stalled = at({ kind: "motor", rpm: 0, stalled: true, powered: true });
      expect(texts(stalled)).toEqual(["stalled"]);
      expect(stalled.elements.some((e) => e.t === "circle")).toBe(true);
      const dead = at({ kind: "motor", rpm: 0, stalled: false, powered: false });
      expect(texts(dead)).toEqual(["no power"]);
      expect(dead.elements.filter((e) => e.t !== "text")).toEqual([]);
    });

    it("marks the stepper shaft and tags its angle and steps", () => {
      const quarter = at({ kind: "stepper", angle: 90, steps: 512, powered: true });
      expect(texts(quarter)).toEqual(["90° · 512 steps"]);
      expect(arm(quarter).x).toBeGreaterThan(1);
      expect(Math.abs(arm(quarter).y)).toBeLessThan(0.01);
    });

    it("tags a reading with its label, value and unit", () => {
      expect(texts(at({ kind: "reading", value: 23.4, unit: "cm", label: "dist" }))).toEqual(["dist 23.4 cm"]);
      expect(texts(at({ kind: "reading", value: 4.98123, unit: "V", label: "" }))).toEqual(["4.98 V"]);
      expect(texts(at({ kind: "reading", value: 0.012, unit: "A", label: "I" }))).toEqual(["I 0.012 A"]);
    });

    it("draws the same under reduced motion", () => {
      const states = new Map<string, PartVisualState>([[circuit.led, { kind: "motor", rpm: 900, stalled: false, powered: true }]]);
      const calm = stateOverlays(scene, states, new Map(), { reduceMotion: true, labels }).find((o) => o.id === `state:${circuit.led}`)!;
      expect(calm).toEqual(at({ kind: "motor", rpm: 900, stalled: false, powered: true }));
    });
  });
});
