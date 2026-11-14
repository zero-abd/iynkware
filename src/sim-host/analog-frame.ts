import type { SimTime } from "@/sim/core/clock";
import type { Readout } from "@/sim/analog/readout";
import { ANALOG_DELTA, type AnalogFrame, type AnalogPartFrame, type AnalogWatch, type InstrumentReading, MAX_WAVE_SAMPLES, MAX_WAVE_WATCH, type WaveSamples } from "./analog-protocol";

/** What the frame builder reads: the solver's present answer and the samples of the probes a scope watches. */
export interface AnalogSource {
  readout(): Readout;
  /** The samples of probe `id` recorded since `from` and the grid step it asked for; null for a probe the run does not have. */
  samples(id: string, from: SimTime): { t: Float64Array; v: Float64Array; stepNs: number } | null;
}

export interface AnalogFrames {
  /** Replaces the watch and makes the next frame a full one; a watch that names nothing stops the stream. */
  watch(watch: AnalogWatch): void;
  /** The change since the last frame returned, or null when there is nothing to send or nothing is watched. */
  frame(now: SimTime): AnalogFrame | null;
}

/** Waves of a probe that was not sampled on a grid are held on one of this step. */
export const DEFAULT_WAVE_STEP_NS = 1_000_000;

/** What a page that watches nothing still gets: the health of the parts and the readings of the bench sources it has put in. */
const NO_WATCH: AnalogWatch = { volts: [], amps: [], pinAmps: false, waves: [] };

const moved = (next: number, last: number | undefined, abs: number): boolean => last === undefined || Math.abs(next - last) > ANALOG_DELTA.rel * Math.abs(last) + abs;

const names = (watch: "all" | string[], all: Iterable<string>): string[] => (watch === "all" ? [...all] : watch);

function changed<T>(ids: string[], read: (id: string) => T | undefined, sent: Map<string, T>, differs: (next: T, last: T | undefined) => boolean, full: boolean): Record<string, T> | undefined {
  const out: Record<string, T> = {};
  for (const id of ids) {
    const next = read(id);
    if (next === undefined) continue;
    const last = sent.get(id);
    if (!full && !differs(next, last)) continue;
    sent.set(id, next);
    out[id] = next;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

interface WaveCursor {
  next: SimTime;
  last: number | null;
}

/**
 * The samples of one probe on a uniform grid up to `now`, holding each value until the next one is recorded. More than
 * `MAX_WAVE_SAMPLES` grid points are thinned to every `stride`th, ending on the newest, so the frame's grid stays uniform.
 */
export function waveSamples(cursor: WaveCursor, raw: { t: Float64Array; v: Float64Array; stepNs: number }, now: SimTime): WaveSamples | null {
  const step = raw.stepNs;
  const first = Math.ceil(cursor.next / step) * step;
  if (first > now) return null;
  const count = Math.floor((now - first) / step) + 1;
  const stride = Math.ceil(count / MAX_WAVE_SAMPLES);
  const offset = (count - 1) % stride;
  const v: number[] = [];
  let fromK = -1;
  let at = 0;
  let held = cursor.last;
  for (let k = 0; k < count; k++) {
    while (at < raw.t.length && raw.t[at] <= first + k * step) held = raw.v[at++];
    if (k < offset || (k - offset) % stride !== 0 || held === null) continue;
    if (fromK < 0) fromK = k;
    v.push(held);
  }
  cursor.next = first + count * step;
  cursor.last = held;
  return v.length === 0 ? null : { fromNs: first + fromK * step, stepNs: step * stride, v };
}

export function createAnalogFrames(source: AnalogSource): AnalogFrames {
  let current: AnalogWatch | null = null;
  let full = true;
  let volts = new Map<string, number>();
  let amps = new Map<string, number>();
  let pinAmps = new Map<string, Record<string, number>>();
  let parts = new Map<string, AnalogPartFrame>();
  let instruments = new Map<string, InstrumentReading>();
  let cursors = new Map<string, WaveCursor>();

  return {
    watch(watch) {
      const stops = watch.volts !== "all" && watch.volts.length === 0 && watch.amps !== "all" && watch.amps.length === 0 && !watch.pinAmps && watch.waves.length === 0;
      current = stops ? null : { ...watch, waves: watch.waves.slice(0, MAX_WAVE_WATCH) };
      full = true;
      volts = new Map();
      amps = new Map();
      pinAmps = new Map();
      parts = new Map();
      instruments = new Map();
      cursors = new Map();
    },

    frame(now) {
      const ro = source.readout();
      if (!current && ro.parts.size === 0 && parts.size === 0 && ro.instruments.size === 0 && instruments.size === 0) return null;
      const watch = current ?? NO_WATCH;
      const frame: AnalogFrame = { full };
      const v = changed(names(watch.volts, ro.volts.keys()), (id) => ro.volts.get(id), volts, (n, l) => moved(n, l, ANALOG_DELTA.voltsAbs), full);
      if (v) frame.volts = v;
      const a = changed(names(watch.amps, ro.amps.keys()), (id) => ro.amps.get(id), amps, (n, l) => moved(n, l, ANALOG_DELTA.ampsAbs), full);
      if (a) frame.amps = a;
      if (watch.pinAmps) {
        const out: Record<string, Record<string, number>> = {};
        for (const [part, pins] of ro.pinAmps) {
          const last = pinAmps.get(part) ?? {};
          const delta: Record<string, number> = {};
          for (const [pin, value] of Object.entries(pins)) if (full || moved(value, last[pin], ANALOG_DELTA.ampsAbs)) delta[pin] = value;
          if (Object.keys(delta).length === 0) continue;
          pinAmps.set(part, { ...last, ...delta });
          out[part] = delta;
        }
        if (Object.keys(out).length > 0) frame.pinAmps = out;
      }
      const p = changed([...ro.parts.keys()], (id) => ro.parts.get(id), parts, (n, l) => l === undefined || n.state !== l.state || moved(n.watts, l.watts, ANALOG_DELTA.wattsAbs), full);
      if (p) frame.parts = p;
      const i = changed(
        [...ro.instruments.keys()],
        (id) => ro.instruments.get(id),
        instruments,
        (n, l) => l === undefined || n.limiting !== l.limiting || moved(n.volts, l.volts, ANALOG_DELTA.voltsAbs) || moved(n.amps, l.amps, ANALOG_DELTA.ampsAbs),
        full,
      );
      if (i) frame.instruments = i;
      const waves: Record<string, WaveSamples> = {};
      for (const id of watch.waves) {
        const cursor = cursors.get(id) ?? { next: 0, last: null };
        cursors.set(id, cursor);
        const raw = source.samples(id, cursor.next);
        const w = raw && waveSamples(cursor, raw, now);
        if (w) waves[id] = w;
      }
      if (Object.keys(waves).length > 0) frame.waves = waves;
      const empty = Object.keys(frame).length === 1;
      if (empty && !full) return null;
      full = false;
      return frame;
    },
  };
}
