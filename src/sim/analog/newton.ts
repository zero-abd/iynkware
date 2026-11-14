import { simDiag, type SolveDiagnostic } from '../core/diagnostic.ts';
import { NEWTON_DEVICES } from './devices/index.ts';
import { freshState, measureElement, PWL_COMPAT, stampElement, type Measured, type PwlState } from './elements.ts';
import { conditionEstimate, linsolve } from './linsolve.ts';
import type { SolveInput } from './solve.ts';
import type { DeviceState, Element, ElementId, SolveResult, TransientMemory, TransientStep } from './types.ts';

export interface NewtonOptions { reltol: number; vabstol: number; iabstol: number; maxIter: number; gmin: number }

export const SPICE_DEFAULTS: NewtonOptions = { reltol: 1e-3, vabstol: 1e-6, iabstol: 1e-12, maxIter: 100, gmin: 1e-12 };

export interface Limiter {
  pnj(vnew: number, vold: number, vt: number, vcrit: number): number;
  /** Keeps `unew` within `reach` of `uold`, so a stiff clamp is approached in steps and not jumped past. */
  within(unew: number, uold: number, reach: number): number;
}

/** What a device writes its linearisation into; nodes are circuit node numbers. */
export interface Stamper {
  // the node every other node is measured from, for a device that drives or senses against it
  ground: number;
  conduct(a: number, b: number, siemens: number): void;
  // a current of `siemens` times (v[cp] - v[cn]) from a to b through the element
  transconduct(a: number, b: number, cp: number, cn: number, siemens: number): void;
  // a constant current from a to b through the element
  current(a: number, b: number, amps: number): void;
  // the junction voltage each device used last iteration, by element id
  junctionVolts: Map<ElementId, number>;
}

const GMIN_START = 1e-2;
const SOURCE_STEPS = 10;
const DAMP_TRIES = 4;
// a latch that keeps flipping between two solutions of one step is left where it is after this many re-solves
const LATCH_ROUNDS = 6;

const LINEAR: ReadonlySet<Element['kind']> = new Set(['R', 'M', 'POT', 'PIN', 'SV']);

// devices whose equations are smooth and need no operating point of their own: a node they alone hold is floating like any other
const SMOOTH: ReadonlySet<Element['kind']> = new Set(['C', 'L', 'V', 'VW', 'PWM']);

// Newton step limiting for a p-n junction, after SPICE's pnjlim
function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): number {
  if (vnew <= vcrit || Math.abs(vnew - vold) <= 2 * vt) return vnew;
  if (vold <= 0) return vt * Math.log(vnew / vt);
  const arg = (vnew - vold) / vt;
  return arg > 0 ? vold + vt * (2 + Math.log(arg - 2)) : vold - vt * (2 + Math.log(2 - arg));
}

const identity: Limiter = { pnj: (vnew) => vnew, within: (unew) => unew };

function trackingLimiter() {
  const lim = {
    limited: false,
    pnj(vnew: number, vold: number, vt: number, vcrit: number) {
      const v = pnjlim(vnew, vold, vt, vcrit);
      if (v !== vnew) lim.limited = true;
      return v;
    },
    within(unew: number, uold: number, reach: number) {
      const u = Math.max(uold - reach, Math.min(uold + reach, unew));
      if (u !== unew) lim.limited = true;
      return u;
    },
  };
  return lim;
}

// The matrix and right-hand side an assembly fills in, kept between assemblies so a step does not allocate them again.
interface Workspace { A: Float64Array[]; b: Float64Array }

const workspaceOf = (rows: number): Workspace => ({ A: Array.from({ length: rows }, () => new Float64Array(rows)), b: new Float64Array(rows) });

// A solve finishes before the next starts, so one pair per matrix size is shared by every circuit of that size.
const workspaces = new Map<number, { solving: Workspace; checking: Workspace }>();

function workspacesFor(rows: number) {
  let pair = workspaces.get(rows);
  if (!pair) workspaces.set(rows, (pair = { solving: workspaceOf(rows), checking: workspaceOf(rows) }));
  return pair;
}

type Residual = { maxAmps: number; worstRow: number; within: boolean; condition: number };

interface Ctx {
  nodes: number;
  ground: number;
  els: Element[];
  states: PwlState[];
  step?: TransientStep;
  o: NewtonOptions;
  ix: (node: number) => number;
  nodeOf: (row: number) => number;
  // the matrix a solve factors in place, and the one a residual reads and leaves alone
  solving: Workspace;
  checking: Workspace;
  // the residual at the last point asked for, for the same elements, step and gmin
  residual?: { x: Float64Array; gmin: number; els: Element[]; step: TransientStep | undefined; value: Residual };
}

// the nodes an element ties together; a capacitor only does so in a transient solve, where it carries current
function terminals(el: Element, transient: boolean): number[] {
  switch (el.kind) {
    case 'R': case 'M': case 'V': case 'D': case 'BZ': return [el.a, el.b];
    case 'Q': return [el.c, el.b, el.e];
    case 'MOS': return [el.d, el.g, el.s];
    case 'POT': return [el.a, el.wiper, el.b];
    case 'PIN': case 'PWM': return [el.a];
    case 'SV': return [el.gnd, el.vplus];
    case 'TS': return [el.supplyPos, el.supplyNeg, el.out];
    case 'C': return transient ? [el.a, el.b] : [];
    case 'L': case 'VW': return [el.a, el.b];
    case 'OA': return [el.out];
    case 'TMR': return [el.gnd, el.vcc, el.ctrl, el.out, el.dis];
    default: return [];
  }
}

type Floating = { node: number; junction: boolean }[];

// The floating nodes found for a circuit, by its first element. Elements are replaced and never edited, so the same elements in the same kind of solve have the same ones.
const floatingKept = new WeakMap<Element, { els: readonly Element[]; nodes: number; ground: number; transient: boolean; found: Floating }>();

function floatingNodes(c: Ctx): Floating {
  const transient = c.step !== undefined;
  const first = c.els[0];
  const kept = first && floatingKept.get(first);
  if (kept && kept.nodes === c.nodes && kept.ground === c.ground && kept.transient === transient && kept.els.length === c.els.length && c.els.every((el, k) => el === kept.els[k])) return kept.found;
  const found = findFloating(c, transient);
  if (first) floatingKept.set(first, { els: c.els, nodes: c.nodes, ground: c.ground, transient, found });
  return found;
}

// nodes with no path to ground, with whether a junction sits on them
function findFloating(c: Ctx, transient: boolean): Floating {
  const parent = Int32Array.from({ length: c.nodes }, (_, node) => node);
  const find = (node: number): number => {
    let root = node;
    while (parent[root] !== root) root = parent[root];
    for (let next = parent[node]; node !== root; node = next, next = parent[node]) parent[node] = root;
    return root;
  };
  for (const el of c.els) {
    const wired = terminals(el, transient);
    if ((el.kind === 'PIN' && el.level !== 'Z') || el.kind === 'PWM' || el.kind === 'OA') wired.push(c.ground);
    for (const node of wired) parent[find(wired[0])] = find(node);
  }
  const grounded = find(c.ground);
  const junctions = new Set(c.els.filter((el) => NEWTON_DEVICES.has(el.kind) && !SMOOTH.has(el.kind)).flatMap((el) => terminals(el, transient).map(find)));
  return Array.from({ length: c.nodes }, (_, node) => node)
    .filter((node) => find(node) !== grounded)
    .map((node) => ({ node, junction: junctions.has(find(node)) }));
}

// rows i and j are the through-element nodes, columns p and n the controlling pair; any of them may be ground (-1)
function transconduct(A: Float64Array[], i: number, j: number, p: number, n: number, g: number): void {
  if (i >= 0) { if (p >= 0) A[i][p] += g; if (n >= 0) A[i][n] -= g; }
  if (j >= 0) { if (p >= 0) A[j][p] -= g; if (n >= 0) A[j][n] += g; }
}

function assemble(c: Ctx, ws: Workspace, x: Float64Array, gmin: number, lim: Limiter, junctionVolts: Map<ElementId, number>) {
  const { A, b } = ws;
  const n = b.length;
  b.fill(0);
  for (let i = 0; i < n; i++) {
    A[i].fill(0);
    A[i][i] = gmin;
  }
  const stamper: Stamper = {
    ground: c.ground,
    conduct: (p, q, g) => transconduct(A, c.ix(p), c.ix(q), c.ix(p), c.ix(q), g),
    transconduct: (p, q, cp, cn, g) => transconduct(A, c.ix(p), c.ix(q), c.ix(cp), c.ix(cn), g),
    current: (p, q, amps) => {
      const i = c.ix(p), j = c.ix(q);
      if (i >= 0) b[i] -= amps;
      if (j >= 0) b[j] += amps;
    },
    junctionVolts,
  };
  c.els.forEach((el, k) => {
    const device = NEWTON_DEVICES.get(el.kind);
    if (device) device.stamp(el, x, stamper, lim, c.step);
    else stampElement(el, A, b, c.ix, c.states[k]);
  });
  return ws;
}

const expand = (c: Ctx, rows: Float64Array) => {
  const full = new Float64Array(c.nodes);
  rows.forEach((value, row) => { full[c.nodeOf(row)] = value; });
  return full;
};

// KCL at x with every device linearised exactly there; `within` is true when every row balances to the tolerances
function residualOf(c: Ctx, x: Float64Array, gmin: number): Residual {
  const kept = c.residual;
  if (kept && kept.x === x && kept.gmin === gmin && kept.els === c.els && kept.step === c.step) return kept.value;
  const { A, b } = assemble(c, c.checking, x, gmin, identity, new Map());
  const volts = Float64Array.from({ length: A.length }, (_, row) => x[c.nodeOf(row)]);
  let maxAmps = 0;
  let worstRow = -1;
  let within = true;
  for (let i = 0; i < A.length; i++) {
    const line = A[i];
    let sum = -b[i];
    let scale = Math.abs(b[i]);
    for (let j = 0; j < line.length; j++) {
      sum += line[j] * volts[j];
      scale += Math.abs(line[j] * volts[j]);
    }
    if (worstRow < 0 || Math.abs(sum) > maxAmps) { maxAmps = Math.abs(sum); worstRow = i; }
    if (Math.abs(sum) > c.o.reltol * scale + c.o.iabstol) within = false;
  }
  const value = { maxAmps, worstRow, within, condition: conditionEstimate(A) };
  c.residual = { x, gmin, els: c.els, step: c.step, value };
  return value;
}

function stepSettled(c: Ctx, x: Float64Array, next: Float64Array): boolean {
  const { reltol, vabstol, iabstol } = c.o;
  for (let node = 0; node < c.nodes; node++) {
    if (Math.abs(next[node] - x[node]) > reltol * Math.max(Math.abs(next[node]), Math.abs(x[node])) + vabstol) return false;
  }
  return c.els.every((el) => {
    const device = NEWTON_DEVICES.get(el.kind);
    if (!device) return true;
    const before = device.currents(el, x, c.step), after = device.currents(el, next, c.step);
    return after.every((amps, k) => Math.abs(amps - before[k]) <= reltol * Math.max(Math.abs(amps), Math.abs(before[k])) + iabstol);
  });
}

interface Run { x: Float64Array; iterations: number; converged: boolean; damped: boolean; fault: number | null }

function run(c: Ctx, x0: Float64Array, gmin: number, junctionVolts: Map<ElementId, number>): Run {
  let x = x0;
  // the residual of the start is only asked for by the first step that has to be damped
  let norm: number | null = null;
  let damped = false;
  for (let iterations = 1; iterations <= c.o.maxIter; iterations++) {
    const lim = trackingLimiter();
    const { A, b } = assemble(c, c.solving, x, gmin, lim, junctionVolts);
    const full = expand(c, linsolve(A, b));
    const bad = full.findIndex((v) => !Number.isFinite(v));
    if (bad >= 0) return { x, iterations, converged: false, damped, fault: bad };
    if (lim.limited || !stepSettled(c, x, full)) {
      let next = full;
      norm ??= residualOf(c, x, gmin).maxAmps;
      let nextNorm = residualOf(c, next, gmin).maxAmps;
      for (let tries = 0; tries < DAMP_TRIES && nextNorm > norm; tries++) {
        next = next.map((v, node) => x[node] + 0.5 * (v - x[node]));
        nextNorm = residualOf(c, next, gmin).maxAmps;
        damped = true;
      }
      x = next;
      norm = nextNorm;
      continue;
    }
    x = full;
    const res = residualOf(c, x, gmin);
    if (res.within) return { x, iterations, converged: true, damped, fault: null };
    norm = res.maxAmps;
  }
  return { x, iterations: c.o.maxIter, converged: false, damped, fault: null };
}

function gminStepping(c: Ctx, x0: Float64Array): Run {
  const junctionVolts = new Map<ElementId, number>();
  let x = x0;
  let iterations = 0;
  for (let gmin = Math.max(GMIN_START, c.o.gmin); ; gmin = Math.max(gmin / 10, c.o.gmin)) {
    const r = run(c, x, gmin, junctionVolts);
    iterations += r.iterations;
    x = r.x;
    if (!r.converged || gmin === c.o.gmin) return { ...r, iterations };
  }
}

function sourceStepping(c: Ctx, x0: Float64Array): Run {
  const junctionVolts = new Map<ElementId, number>();
  let x = x0;
  let iterations = 0;
  let r: Run = { x, iterations, converged: true, damped: false, fault: null };
  for (let step = 1; step <= SOURCE_STEPS; step++) {
    const scale = step / SOURCE_STEPS;
    const scaled = c.els.map((el) => (el.kind === 'V' ? { ...el, volts: el.volts * scale } : el.kind === 'PIN' ? { ...el, vHighVolts: el.vHighVolts * scale } : el.kind === 'VW' ? { ...el, amplitudeV: el.amplitudeV * scale, offsetV: el.offsetV * scale } : el));
    r = run({ ...c, els: scaled }, x, c.o.gmin, junctionVolts);
    iterations += r.iterations;
    x = r.x;
    if (!r.converged) break;
  }
  return { ...r, iterations };
}

const nodeRef = (node: number) => ({ net: String(node) });

function failure(nodes: number, iterations: number, worstNode: number, diagnostics: SolveDiagnostic[]): SolveResult {
  return {
    converged: false,
    iterations,
    strategy: 'direct',
    v: new Float64Array(nodes),
    branch: {},
    state: {},
    residual: { maxKclAmps: NaN, worstNode },
    diagnostics,
  };
}

interface Converged { r: Run; strategy: SolveResult['strategy']; iterations: number }

function converge(c: Ctx, start: Float64Array): Converged {
  let r = run(c, start, c.o.gmin, new Map());
  let strategy: SolveResult['strategy'] = r.damped ? 'damped' : 'direct';
  let iterations = r.iterations;
  if (!r.converged && r.fault === null) {
    r = gminStepping(c, start);
    strategy = 'gmin-stepping';
    iterations += r.iterations;
  }
  if (!r.converged && r.fault === null) {
    r = sourceStepping(c, start);
    strategy = 'source-stepping';
    iterations += r.iterations;
  }
  return { r, strategy, iterations };
}

const withLatches = (els: Element[], latches: Map<ElementId, 0 | 1>) => els.map((el) => (el.kind === 'TMR' ? { ...el, latch: latches.get(el.id) } : el));

// The 555's latch is a state, so a solve settles it: re-solve with the latch the solution asks for until they agree.
// A flip inside a transient step is a discontinuity, and the re-solve of that step is backward Euler.
function settleLatches(c: Ctx, els: Element[], start: Float64Array, prev: TransientMemory): Converged {
  const latches = new Map<ElementId, 0 | 1>();
  for (const el of els) {
    const kept = prev[el.id];
    if (el.kind === 'TMR') latches.set(el.id, kept?.kind === 'TMR' ? kept.q : (el.latch ?? 0));
  }
  let total = 0;
  let out: Converged;
  for (let round = 0; ; round++) {
    c.els = withLatches(els, latches);
    out = converge(c, start);
    total += out.iterations;
    if (!out.r.converged) break;
    const flips = c.els.flatMap((el) => {
      if (el.kind !== 'TMR') return [];
      const mem = NEWTON_DEVICES.get(el.kind)?.memory?.(el, out.r.x, c.step);
      return mem?.kind === 'TMR' && mem.q !== el.latch ? [[el.id, mem.q] as const] : [];
    });
    if (flips.length === 0 || round + 1 >= LATCH_ROUNDS) break;
    for (const [id, q] of flips) latches.set(id, q);
    if (c.step?.method === 'trapezoidal') c.step = { ...c.step, method: 'backward-euler' };
    start = out.r.x;
  }
  return { ...out, iterations: total };
}

export function newtonSolve(g: SolveInput, options: Partial<NewtonOptions> = {}, warm?: Float64Array): SolveResult {
  const o = { ...SPICE_DEFAULTS, ...options };
  const { nodes, ground } = g;
  const diagnostics: SolveDiagnostic[] = [];
  const els = g.elements.filter((el) => {
    if (LINEAR.has(el.kind) || NEWTON_DEVICES.has(el.kind)) return true;
    diagnostics.push(simDiag('not-modelled-yet', 'warning', { part: el.id }, { kind: el.kind }));
    return false;
  });
  for (const el of els) {
    const reason = NEWTON_DEVICES.get(el.kind)?.validate(el);
    if (reason) diagnostics.push(simDiag('invalid-device-params', 'error', { part: el.id }, { reason }));
  }
  if (g.transient && !(g.transient.hSeconds > 0)) diagnostics.push(simDiag('invalid-device-params', 'error', {}, { reason: `step ${g.transient.hSeconds} s is not positive` }));
  if (diagnostics.some((d) => d.id === 'invalid-device-params')) return failure(nodes, 0, ground, diagnostics);

  const c: Ctx = {
    nodes,
    ground,
    els,
    step: g.transient,
    states: els.map((el) => {
      const st = freshState(el.kind === 'M' ? 1 / Math.max(el.ohms, PWL_COMPAT.minOhms) : 0);
      st.high = el.kind === 'PIN' && el.level === 1;
      return st;
    }),
    o,
    ...workspacesFor(nodes - 1),
    ix: (node) => (node === ground ? -1 : node > ground ? node - 1 : node),
    nodeOf: (row) => (row >= ground ? row + 1 : row),
  };

  const floating = floatingNodes(c);
  for (const { node } of floating) diagnostics.push(simDiag('floating-node', 'warning', nodeRef(node), { node }));
  const stranded = floating.find((f) => f.junction);
  if (stranded) {
    diagnostics.push(simDiag('no-convergence', 'error', nodeRef(stranded.node), { node: stranded.node, iterations: 0 }));
    return failure(nodes, 0, stranded.node, diagnostics);
  }

  const start = new Float64Array(nodes);
  if (warm?.length === nodes) start.set(warm);
  start[ground] = 0;

  const { r, strategy, iterations } = settleLatches(c, els, start, g.transient?.prev ?? {});
  if (r.fault !== null) {
    return failure(nodes, iterations, r.fault, [...diagnostics, simDiag('numeric-fault', 'error', nodeRef(r.fault), { node: r.fault })]);
  }

  const x = r.x;
  const volts = (node: number) => x[node];
  const res = residualOf(c, x, o.gmin);
  const worstNode = res.worstRow < 0 ? ground : c.nodeOf(res.worstRow);
  const branch: Record<ElementId, Measured> = {};
  const state: Record<ElementId, DeviceState> = {};
  const memory: TransientMemory = {};
  c.els.forEach((el, k) => {
    const device = NEWTON_DEVICES.get(el.kind);
    if (device) {
      const { state: region, ...measured } = device.measure(el, x, c.step);
      branch[el.id] = measured;
      if (region) state[el.id] = region;
      const kept = device.memory?.(el, x, c.step);
      if (kept) memory[el.id] = kept;
    } else {
      branch[el.id] = measureElement(el, c.states[k], volts);
      if (el.kind === 'PIN' && el.level === 'Z') state[el.id] = 'open';
    }
  });
  if (!r.converged) diagnostics.push(simDiag('no-convergence', 'error', nodeRef(worstNode), { node: worstNode, iterations }));
  if (res.condition > PWL_COMPAT.maxCondition) diagnostics.push(simDiag('ill-conditioned', 'warning', nodeRef(worstNode), { node: worstNode, condition: res.condition }));

  return {
    converged: r.converged,
    iterations,
    strategy,
    v: x,
    branch,
    state,
    residual: { maxKclAmps: res.maxAmps, worstNode },
    diagnostics,
    ...(Object.keys(memory).length > 0 ? { memory } : {}),
  };
}
