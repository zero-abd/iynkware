import { nextPwmEdge } from './devices/pwm.ts';
import { newtonSolve, type NewtonOptions } from './newton.ts';
import type { SolveInput } from './solve.ts';
import type { Element, IntegrationMethod, SolveOptions, SolveResult, TransientMemory, TransientStep } from './types.ts';
import { waveValue } from './waveform.ts';

type Circuit = Omit<SolveInput, 'transient'>;

/** Where a run stood: enough to carry on from it without solving the operating point again. */
export interface RunState { seconds: number; memory: TransientMemory; result: SolveResult; backward: boolean; quiet?: number }

// An event between grid points is solved as a backward Euler step this short, so the reactive parts keep their state and the rest jumps.
export const SETTLE_SECONDS = 1e-9;

// A square or pulse source jumps between two values; a step across the jump is a discontinuity (SIMULATION 7.4).
function edgeIn(elements: readonly Element[], t0: number, t1: number): boolean {
  return elements.some((el) => el.kind === 'VW' && (el.shape === 'square' || el.shape === 'pulse') && waveValue(el, t0) !== waveValue(el, t1));
}

// A step that leaves every node voltage and every reactive state where it was, to a nanovolt, has settled; with nothing
// changing and no source on a clock, the steps after it would give the same answer, so a run that has had this many in a row stops solving them.
const QUIET = 1e-9;
const QUIET_STEPS = 3;

const moved = (a: number, b: number): boolean => Math.abs(a - b) > QUIET * Math.max(1, Math.abs(a), Math.abs(b));

function movedFrom(before: SolveResult, after: SolveResult, kept: TransientMemory): boolean {
  if (!after.converged || !before.converged || after.v.length !== before.v.length) return true;
  if (after.v.some((v, node) => moved(v, before.v[node]))) return true;
  const memory = after.memory ?? {};
  return Object.keys(memory).some((id) => {
    const was = kept[id] as unknown as Record<string, unknown> | undefined;
    const now = memory[id] as unknown as Record<string, unknown>;
    return !was || Object.keys(now).some((field) => (typeof now[field] === 'number' ? moved(now[field] as number, was[field] as number) : now[field] !== was[field]));
  });
}

const onAClock = (elements: readonly Element[]): boolean => elements.some((el) => (el.kind === 'VW' && el.hz > 0 && el.amplitudeV !== 0) || (el.kind === 'PWM' && Number.isFinite(nextPwmEdge(el, 0))));

const newtonOptions = (o: SolveOptions): NewtonOptions => ({ reltol: o.reltol, vabstol: o.vabstol, iabstol: o.iabstol, maxIter: o.maxIter, gmin: o.gminSiemens });

/**
 * A circuit stepped through time on a grid of `hSeconds`; an event between grid points takes a shorter step to the grid, and so does the edge of a PWM pin. It starts from the operating point with the
 * capacitors open and the inductors shorted (`v0` and `i0` then set where those elements start), takes the first step
 * and every step across a discontinuity with backward Euler and all others with the trapezoidal rule.
 * The caller may replace `elements` between steps; call `disturb()` when it did, so the next step is backward Euler.
 */
export class TransientRun {
  elements: Element[];
  /** What the last step left behind. */
  result: SolveResult;
  private memory: TransientMemory;
  private seconds = 0;
  private backward = true;
  // steps in a row that moved nothing; the run stops solving at QUIET_STEPS, until something is changed
  private quiet = 0;
  private readonly circuit: Circuit;
  private readonly options: NewtonOptions;
  private readonly h: number;

  /**
   * `from` carries on from a saved state. Without it the run starts at `startSeconds` from the operating point, with the
   * capacitors and inductors at their `v0` and `i0`, or at what `carry` holds for them when it has them.
   */
  constructor(circuit: Circuit, o: SolveOptions, hSeconds: number, from?: RunState, startSeconds = 0, carry: TransientMemory = {}) {
    if (!(hSeconds > 0)) throw new RangeError(`transient: step ${hSeconds} s is not positive`);
    this.circuit = circuit;
    this.elements = circuit.elements;
    this.options = newtonOptions(o);
    this.h = hSeconds;
    if (from) {
      this.seconds = from.seconds;
      this.result = from.result;
      this.memory = { ...from.memory };
      this.backward = from.backward;
      this.quiet = from.quiet ?? 0;
      return;
    }
    this.seconds = startSeconds;
    this.result = newtonSolve(circuit, this.options);
    this.memory = { ...this.result.memory };
    for (const el of circuit.elements) {
      const kept = this.memory[el.id];
      const carried = carry[el.id];
      if (carried?.kind === kept?.kind && carried !== undefined) this.memory[el.id] = { ...carried };
      else if (el.kind === 'C' && el.v0 !== undefined && kept?.kind === 'C') this.memory[el.id] = { ...kept, v: el.v0 };
      else if (el.kind === 'L' && el.i0 !== undefined && kept?.kind === 'L') this.memory[el.id] = { ...kept, i: el.i0 };
    }
  }

  get t(): number {
    return this.seconds;
  }

  disturb(): void {
    this.backward = true;
    this.quiet = 0;
  }

  state(): RunState {
    return { seconds: this.seconds, memory: this.memory, result: this.result, backward: this.backward, quiet: this.quiet };
  }

  /**
   * One step to `toSeconds`, a whole grid step or a shorter one when an event landed between grid points. A step never
   * crosses the edge of a PWM pin: it stops there and the step after it is backward Euler.
   */
  step(toSeconds = this.nextGrid()): SolveResult {
    if (this.quiet >= QUIET_STEPS && !onAClock(this.elements)) {
      this.seconds = toSeconds;
      return this.result;
    }
    const edge = this.nextEdge();
    const end = Math.min(toSeconds, edge);
    const length = end - this.seconds;
    const regular = Math.abs(length - this.h) <= this.h * 1e-9;
    const method: IntegrationMethod = this.backward || !regular || edgeIn(this.elements, this.seconds, end) ? 'backward-euler' : 'trapezoidal';
    const r = newtonSolve({ ...this.circuit, elements: this.elements, transient: { tSeconds: end, hSeconds: length, method, prev: this.memory } }, this.options, this.result.v);
    this.quiet = movedFrom(this.result, r, this.memory) ? 0 : this.quiet + 1;
    this.seconds = end;
    this.backward = edge <= toSeconds;
    return this.keep(r);
  }

  /** Solves again at the same time after the elements changed: the reactive parts hold their state and the rest jumps. */
  settle(): SolveResult {
    const step: TransientStep = { tSeconds: this.seconds, hSeconds: SETTLE_SECONDS, method: 'backward-euler', prev: this.memory };
    this.backward = true;
    this.quiet = 0;
    return this.keep(newtonSolve({ ...this.circuit, elements: this.elements, transient: step }, this.options, this.result.v));
  }

  /** Steps until the time reaches `seconds`, calling `each` after every step. */
  advanceTo(seconds: number, each?: (r: SolveResult, t: number) => void): SolveResult {
    while (this.seconds + this.h * 1e-6 < seconds) {
      const r = this.step(Math.min(this.nextGrid(), seconds));
      each?.(r, this.seconds);
    }
    return this.result;
  }

  private nextEdge(): number {
    let edge = Infinity;
    for (const el of this.elements) if (el.kind === 'PWM') edge = Math.min(edge, nextPwmEdge(el, this.seconds));
    return edge;
  }

  private nextGrid(): number {
    return (Math.floor(this.seconds / this.h + 1e-9) + 1) * this.h;
  }

  private keep(r: SolveResult): SolveResult {
    this.result = r;
    if (r.memory) this.memory = r.memory;
    return r;
  }
}
