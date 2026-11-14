import type { Element } from './types.ts';

/** Floor and ceiling of a step chosen from the circuit: 100 000 steps per simulated second is what a page keeps up with at real time. */
export const MIN_STEP_NS = 10_000;
export const MAX_STEP_NS = 1_000_000;
/** The step with nothing to size it by: a circuit of sources and diodes whose only reactive parts have no resistor to a source. */
const IDLE_STEP_NS = 100_000;
const STEPS_PER_TAU = 50;
const STEPS_PER_PERIOD = 100;
/** A resistance below this is a wire, not something a time constant hangs on. */
const WIRE_OHMS = 1;
const GROUND = 0;

interface Edge { to: number; ohms: number; by: string }

interface Network {
  edges: Map<number, Edge[]>;
  /** The resistance of the stiffest source on each node a source holds: a supply, a generator or an output pin. */
  held: Map<number, number>;
}

function networkOf(elements: readonly Element[]): Network {
  const edges = new Map<number, Edge[]>();
  const held = new Map<number, number>([[GROUND, 0]]);
  const link = (by: string, a: number, b: number, ohms: number) => {
    const weight = Math.max(WIRE_OHMS, ohms);
    for (const [from, to] of [[a, b], [b, a]] as const) edges.set(from, [...(edges.get(from) ?? []), { to, ohms: weight, by }]);
  };
  const hold = (node: number, ohms: number) => held.set(node, Math.min(held.get(node) ?? Infinity, ohms));
  for (const e of elements) {
    switch (e.kind) {
      case 'R': case 'M': link(e.id, e.a, e.b, e.ohms); break;
      case 'D': link(e.id, e.a, e.b, Math.max(e.rdOhms, e.junction?.rsOhms ?? 0, e.junction?.rzOhms ?? 0)); break;
      case 'L': link(e.id, e.a, e.b, e.dcrOhms); break;
      case 'V': case 'VW': hold(e.a, e.rSeriesOhms); break;
      case 'PIN': case 'PWM': hold(e.a, e.rOutOhms); break;
      default: break;
    }
  }
  return { edges, held };
}

/** The least resistance from `start` along resistors and diodes, other than `except`, to a node a source holds, plus that source's own; Infinity when there is none. */
function pathOhms({ edges, held }: Network, start: number, except: string): number {
  const dist = new Map<number, number>([[start, 0]]);
  const open = new Set<number>([start]);
  while (open.size > 0) {
    let node = -1;
    let best = Infinity;
    for (const n of open) {
      const d = dist.get(n)!;
      if (d < best) { best = d; node = n; }
    }
    open.delete(node);
    if (node !== start && held.has(node)) return best + held.get(node)!;
    for (const { to, ohms, by } of edges.get(node) ?? []) {
      if (by !== except && best + ohms < (dist.get(to) ?? Infinity)) {
        dist.set(to, best + ohms);
        open.add(to);
      }
    }
  }
  return Infinity;
}

/** The resistance a part sees from `node`: the way to a source, or when no source holds any node it reaches (a bench supply is put on at run time) the smallest resistor on the node. */
function ohmsFrom(net: Network, node: number, except: string): number {
  const path = pathOhms(net, node, except);
  return Number.isFinite(path) ? path : Math.min(...(net.edges.get(node) ?? []).filter((e) => e.by !== except).map((e) => e.ohms));
}

/** Rounded down to 1, 2 or 5 times a power of ten, so the step reads as a bench setting. */
function ladder(ns: number): number {
  const decade = 10 ** Math.floor(Math.log10(ns));
  return decade * ([5, 2, 1].find((m) => m * decade <= ns) ?? 1);
}

/**
 * The step a transient run takes when the project names none: fine enough for the fastest time constant a capacitor
 * or inductor has (`RC`, `L/R`, with R the way through resistors and diodes to the nearest source), and for a hundred
 * points a period of a waveform source, but never finer than the page can follow. The resistance is an estimate that
 * leaves out parallel paths, so the step errs small.
 */
export function autoStepNs(elements: readonly Element[]): number {
  const net = networkOf(elements);
  let seconds = Infinity;
  for (const e of elements) {
    if (e.kind === 'C' || e.kind === 'L') {
      const ohms = Math.min(...[e.a, e.b].filter((n) => !net.held.has(n)).map((n) => ohmsFrom(net, n, e.id)));
      if (Number.isFinite(ohms)) seconds = Math.min(seconds, (e.kind === 'C' ? e.farads * (ohms + e.esrOhms) : e.henries / (ohms + e.dcrOhms)) / STEPS_PER_TAU);
    }
  }
  seconds = Math.min(seconds, clockSeconds(elements));
  return Number.isFinite(seconds) ? benchStep(seconds) : IDLE_STEP_NS;
}

/**
 * The step a hundred points a period of the fastest waveform source asks for, or null when no source is on a clock.
 * A step a project names is cut to this, or a 1 kHz generator stepped every millisecond is caught at the same point of
 * its period every step and reads as a flat line.
 */
export function clockStepNs(elements: readonly Element[]): number | null {
  const seconds = clockSeconds(elements);
  return Number.isFinite(seconds) ? benchStep(seconds) : null;
}

const clockSeconds = (elements: readonly Element[]): number =>
  Math.min(...elements.map((e) => (e.kind === 'VW' && e.hz > 0 ? 1 / (STEPS_PER_PERIOD * e.hz) : Infinity)));

/** The step a hundred points a period of a waveform source at `hz` asks for, as `clockStepNs` has it for one source. */
export const waveStepNs = (hz: number): number => benchStep(1 / (STEPS_PER_PERIOD * hz));

const benchStep = (seconds: number): number => Math.min(MAX_STEP_NS, Math.max(MIN_STEP_NS, ladder(seconds * 1e9)));
