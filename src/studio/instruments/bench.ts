import type { Instrument } from "../../project/generated/types.ts";
import type { InstrumentSource, WaveShape } from "../../sim/analog/types.ts";

export const WAVE_SHAPES: readonly WaveShape[] = ["sine", "square", "triangle", "pulse"];

/** The ranges of a bench generator and a bench supply; a value outside them is held at the nearest end. */
export const BENCH_LIMITS = {
  hz: { min: 0.1, max: 1e6 },
  amplitudeV: { min: 0, max: 10 },
  offsetV: { min: -10, max: 10 },
  dutyPercent: { min: 1, max: 99 },
  volts: { min: 0, max: 30 },
  limitAmps: { min: 0.001, max: 3 },
} as const;

/** The output resistance of a bench function generator. */
export const FGEN_OUTPUT_OHMS = 50;

export interface FgenSettings {
  shape: WaveShape;
  hz: number;
  /** Peak, not peak to peak. */
  amplitudeV: number;
  offsetV: number;
  dutyPercent: number;
  on: boolean;
  /** Net the return lead is on; absent for ground. */
  neg?: string;
}

export interface PsuSettings {
  volts: number;
  limitAmps: number;
  on: boolean;
  neg?: string;
}

const clamp = (value: unknown, { min, max }: { min: number; max: number }, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const negOf = (raw: Record<string, unknown>): { neg?: string } => (typeof raw.neg === "string" && raw.neg !== "" ? { neg: raw.neg } : {});

export function fgenSettings(settings: Instrument["settings"]): FgenSettings {
  const raw = (settings ?? {}) as Record<string, unknown>;
  const shape = WAVE_SHAPES.find((s) => s === raw.shape) ?? "sine";
  return {
    shape,
    hz: clamp(raw.hz, BENCH_LIMITS.hz, 1000),
    amplitudeV: clamp(raw.amplitudeV, BENCH_LIMITS.amplitudeV, 1),
    offsetV: clamp(raw.offsetV, BENCH_LIMITS.offsetV, 0),
    dutyPercent: clamp(raw.dutyPercent, BENCH_LIMITS.dutyPercent, 50),
    on: raw.on !== false,
    ...negOf(raw),
  };
}

export function psuSettings(settings: Instrument["settings"]): PsuSettings {
  const raw = (settings ?? {}) as Record<string, unknown>;
  return {
    volts: clamp(raw.volts, BENCH_LIMITS.volts, 5),
    limitAmps: clamp(raw.limitAmps, BENCH_LIMITS.limitAmps, 0.1),
    on: raw.on !== false,
    ...negOf(raw),
  };
}

/** What the run is told, or null while the output is off. `pos` and `neg` are the run's net ids. */
export function fgenSource(s: FgenSettings, pos: string, neg: string): InstrumentSource | null {
  if (!s.on) return null;
  return {
    kind: "fgen",
    pos,
    neg,
    wave: { shape: s.shape, amplitudeV: s.amplitudeV, offsetV: s.offsetV, hz: s.hz, duty: s.dutyPercent / 100, phaseDeg: 0 },
    rSeriesOhms: FGEN_OUTPUT_OHMS,
  };
}

export function psuSource(s: PsuSettings, pos: string, neg: string): InstrumentSource | null {
  return s.on ? { kind: "psu", pos, neg, volts: s.volts, limitAmps: s.limitAmps } : null;
}

/** The settings an instrument keeps, with `patch` merged over them; a key patched to undefined is dropped. */
export function withSettings(instrument: Instrument, patch: Record<string, unknown>): Instrument {
  const merged = { ...instrument.settings, ...patch };
  return { ...instrument, settings: Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) };
}
