import type { PartInput } from "../../sim/engine.ts";
import { type SensorInput, sensorInputOf } from "../../sim/sensors/inputs.ts";
import type { Hit, Overlay, PointMm, RectMm, Scene } from "../engine/types.ts";
import type { DocStore } from "../stores/doc.ts";

/** A dial is a sensor: dragging round it moves what it senses (light, force, distance...) between its limits. */
type Kind = "button" | "switch" | "knob" | "dial";

/** The parts a person can work while the run is going, by definition. */
const KIND_OF: Readonly<Record<string, Kind>> = {
  "core.push-button-6mm": "button",
  "core.slide-switch": "switch",
  "core.potentiometer-10k": "knob",
};

const CURSOR: Record<Kind, string> = { button: "pointer", switch: "pointer", knob: "grab", dial: "grab" };
const KNOB_SWEEP_RAD = (270 * Math.PI) / 180;
const DEFAULT_POS = 0.5;
const RING_PAD_MM = 0.8;
const RING_SW = 0.5;
const INK = "var(--studio-ink)";
const HELD = "var(--color-mint-m)";

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const angleOf = (centre: PointMm, at: PointMm): number => Math.atan2(at.y - centre.y, at.x - centre.x);

/** The turn between two angles by the short way round; each move is small, so the sum follows a drag all the way round. */
const turnBetween = (from: number, to: number): number => {
  const d = to - from;
  return Math.atan2(Math.sin(d), Math.cos(d));
};

export type OperatorDeps = {
  doc: Pick<DocStore, "getState">;
  /** True while the run is going; the controls only work then. */
  running(): boolean;
  /** Sends the input to the run. It is run data and never touches the document. */
  input(input: PartInput): void;
  scene(): Scene;
};

/**
 * Working the parts of a running circuit from the canvas (SIM_ANALOG section 8). A press on a push button closes it until
 * the pointer lets go, a click on a slide switch flips it, and dragging round a pot's body turns its knob. The values live
 * here for the length of the run, so the document never changes.
 */
export interface PartOperator {
  /** The cursor over `hit` at `at` (mm), or null when nothing there can be worked or the run is not going. */
  hover(hit: Hit | null, at: PointMm): string | null;
  /** True when the press landed on a part that can be worked and is now held. */
  down(hit: Hit | null, at: PointMm): boolean;
  move(at: PointMm): void;
  up(): void;
  /** The hover ring and the state of a held or flipped part, for the canvas. */
  overlays(): Overlay[];
  subscribe(fn: () => void): () => void;
}

type Held = { c: string; kind: Kind; centre: PointMm; angle: number; pos: number };

export function createPartOperator({ doc, running, input, scene }: OperatorDeps): PartOperator {
  const values = new Map<string, number>();
  const listeners = new Set<() => void>();
  let hovered: string | null = null;
  let held: Held | null = null;
  let wasRunning = false;

  const notify = () => {
    for (const fn of [...listeners]) fn();
  };

  const refOf = (c: string): string | null => doc.getState().state.components.find((x) => x.id === c)?.definition.ref ?? null;

  function kindOf(c: string): Kind | null {
    const ref = refOf(c);
    if (ref === null) return null;
    return KIND_OF[ref] ?? (sensorInputOf(ref) ? "dial" : null);
  }

  const sensorOf = (c: string): SensorInput | null => {
    const ref = refOf(c);
    return ref === null ? null : sensorInputOf(ref);
  };

  /** A dial's value in its own unit: what this run set, else the part's setting, else the sensor's default. */
  function dialValue(c: string, sensor: SensorInput): number {
    const known = values.get(c);
    if (known !== undefined) return known;
    const param = doc.getState().state.components.find((x) => x.id === c)?.params?.[sensor.param];
    return typeof param === "number" ? param : sensor.default;
  }

  const dialLabel = (value: number, sensor: SensorInput): string =>
    [sensor.label, `${Math.round(value * 10) / 10}`, sensor.unit].filter((s) => s !== undefined && s !== "").join(" ");

  /** Where the control stands now: what this run set, else what the lesson's input starts at, else the part's own setting. */
  function valueOf(c: string, kind: Kind): number {
    const known = values.get(c);
    if (known !== undefined) return known;
    const { components, simulation } = doc.getState().state;
    const tied = kind === "knob" ? simulation.world.inputs.find((i) => i.component === c && i.max > i.min) : undefined;
    if (tied) return clamp01((tied.default - tied.min) / (tied.max - tied.min));
    const param = components.find((x) => x.id === c)?.params?.[kind === "knob" ? "pos" : "closed"];
    return typeof param === "number" ? param : kind === "knob" ? DEFAULT_POS : 0;
  }

  const boxOf = (c: string): RectMm | null => scene().targets.find((t) => t.hit.kind === "part" && t.hit.c === c)?.bbox ?? null;

  /** The part to work at `at`: the one the hit names, or the one under the point when a breadboard hole took the hit. */
  function partAt(hit: Hit | null, at: PointMm): { c: string; kind: Kind } | null {
    if (hit?.kind === "part" || hit?.kind === "pin") {
      const kind = kindOf(hit.c);
      if (kind !== null) return { c: hit.c, kind };
    }
    for (const { hit: target, bbox } of scene().targets) {
      if (target.kind !== "part" || at.x < bbox.x0 || at.x > bbox.x1 || at.y < bbox.y0 || at.y > bbox.y1) continue;
      const kind = kindOf(target.c);
      if (kind !== null) return { c: target.c, kind };
    }
    return null;
  }

  function send(c: string, kind: Kind, value: number) {
    values.set(c, value);
    const param = kind === "button" ? "pressed" : kind === "switch" ? "closed" : kind === "dial" ? (sensorOf(c)?.param ?? "pos") : "pos";
    input({ part: c, param, value });
    notify();
  }

  /** The values belong to one run: a stopped run starts the next from the document again. */
  function settle(): boolean {
    const now = running();
    if (wasRunning && !now) {
      values.clear();
      held = null;
      hovered = null;
      notify();
    }
    wasRunning = now;
    return now;
  }

  function ringOf(c: string, colour: string, label?: string): Overlay | null {
    const box = boxOf(c);
    if (!box) return null;
    const w = box.x1 - box.x0 + 2 * RING_PAD_MM;
    const h = box.y1 - box.y0 + 2 * RING_PAD_MM;
    return {
      id: `operate:${c}`,
      xMm: box.x0 - RING_PAD_MM,
      yMm: box.y0 - RING_PAD_MM,
      elements: [
        { t: "rect", x: 0, y: 0, w, h, rx: 1, fill: "none", stroke: colour, sw: RING_SW },
        ...(label === undefined ? [] : [{ t: "text" as const, x: w / 2, y: -0.8, s: label, size: 1.6, anchor: "middle" as const, legible: "up" as const }]),
      ],
    };
  }

  const percent = (pos: number): string => `${Math.round(pos * 100)}%`;

  return {
    hover(hit, at) {
      if (!settle()) return null;
      const found = partAt(hit, at);
      const next = found?.c ?? null;
      if (next !== hovered) {
        hovered = next;
        notify();
      }
      return found === null ? null : held ? "grabbing" : CURSOR[found.kind];
    },

    down(hit, at) {
      if (!settle()) return false;
      const found = partAt(hit, at);
      const box = found && boxOf(found.c);
      if (!found || !box) return false;
      const { c, kind } = found;
      const centre = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
      const sensor = kind === "dial" ? sensorOf(c) : null;
      const pos = sensor ? clamp01((dialValue(c, sensor) - sensor.min) / (sensor.max - sensor.min)) : valueOf(c, kind);
      held = { c, kind, centre, angle: angleOf(centre, at), pos };
      if (kind === "button") send(c, kind, 1);
      else if (kind === "switch") send(c, kind, valueOf(c, kind) > 0 ? 0 : 1);
      else notify();
      return true;
    },

    move(at) {
      if (!held || (held.kind !== "knob" && held.kind !== "dial")) return;
      const angle = angleOf(held.centre, at);
      held.pos = clamp01(held.pos + turnBetween(held.angle, angle) / KNOB_SWEEP_RAD);
      held.angle = angle;
      const sensor = held.kind === "dial" ? sensorOf(held.c) : null;
      send(held.c, held.kind, sensor ? sensor.min + held.pos * (sensor.max - sensor.min) : held.pos);
    },

    up() {
      const done = held;
      held = null;
      if (done?.kind === "button") send(done.c, "button", 0);
      else notify();
    },

    overlays() {
      const out: Overlay[] = [];
      const shown = new Set<string>();
      // every sensor shows what it senses while the run goes, so it is plain that dragging round it changes it
      if (running()) {
        for (const part of doc.getState().state.components) {
          const sensor = sensorInputOf(part.definition.ref);
          if (!sensor) continue;
          const ring = ringOf(part.id, values.has(part.id) || held?.c === part.id || hovered === part.id ? HELD : INK, dialLabel(dialValue(part.id, sensor), sensor));
          if (ring) {
            out.push(ring);
            shown.add(part.id);
          }
        }
      }
      for (const [c, value] of values) {
        const kind = kindOf(c);
        if (kind === null || kind === "dial") continue;
        const ring = ringOf(c, kind === "button" && value === 0 ? INK : HELD, kind === "knob" ? percent(value) : kind === "switch" ? (value > 0 ? "B" : "A") : undefined);
        if (ring && (kind !== "button" || value > 0)) {
          out.push(ring);
          shown.add(c);
        }
      }
      if (hovered !== null && !shown.has(hovered)) {
        const ring = ringOf(hovered, INK);
        if (ring) out.push(ring);
      }
      return out;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}
