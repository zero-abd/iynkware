// Writes the ngspice transient traces the transient test compares the solver to: an RC charge, an underdamped RLC and a
// half-wave rectifier with a smoothing capacitor, each at a 1 microsecond step. ngspice runs as eecircuit-engine 1.9.0
// (WASM); CI never runs this, it reads the file.
// node scripts/gen-ngspice-transient.mjs [--out <file>] [--engine-dir <dir>/node_modules/eecircuit-engine] [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const ENGINE = 'eecircuit-engine@1.9.0';
const STEP = 1e-6;
const GRID = 20e-6;

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const out = resolve(ROOT, flag('--out') ?? 'src/sim/analog/fixtures/ngspice/transient.json');
const engineDir = flag('--engine-dir') ?? resolve(ROOT, 'node_modules/eecircuit-engine');

const CASES = [
  {
    id: 'RC',
    stopSeconds: 5e-3,
    nodes: ['GND', 'in', 'out'],
    elements: [
      { id: 'V1', kind: 'V', a: 1, b: 0, volts: 5, rSeriesOhms: 0 },
      { id: 'R1', kind: 'R', a: 1, b: 2, ohms: 1000 },
      { id: 'C1', kind: 'C', a: 2, b: 0, farads: 1e-6, esrOhms: 0, v0: 0, polarized: false },
    ],
  },
  {
    id: 'RLC',
    stopSeconds: 500e-6,
    nodes: ['GND', 'in', 'mid', 'out'],
    elements: [
      { id: 'V1', kind: 'V', a: 1, b: 0, volts: 5, rSeriesOhms: 0 },
      { id: 'R1', kind: 'R', a: 1, b: 2, ohms: 10 },
      { id: 'L1', kind: 'L', a: 2, b: 3, henries: 1e-3, dcrOhms: 0, i0: 0 },
      { id: 'C1', kind: 'C', a: 3, b: 0, farads: 1e-6, esrOhms: 0, v0: 0, polarized: false },
    ],
  },
  {
    id: 'RECTIFIER',
    stopSeconds: 10e-3,
    nodes: ['GND', 'in', 'out'],
    elements: [
      { id: 'V1', kind: 'VW', a: 1, b: 0, shape: 'sine', amplitudeV: 5, offsetV: 0, hz: 1000, duty: 0.5, phaseDeg: 0, rSeriesOhms: 0 },
      { id: 'D1', kind: 'D', a: 1, b: 2, modelId: 'model:diode.pwl@1', vf: 0.7, rdOhms: 0.2, maxAmps: 1, junction: { kind: 'shockley', isAmps: 1e-14, n: 1, rsOhms: 1 } },
      { id: 'C1', kind: 'C', a: 2, b: 0, farads: 10e-6, esrOhms: 0, v0: 0, polarized: false },
      { id: 'R1', kind: 'R', a: 2, b: 0, ohms: 1000 },
    ],
  },
];

const name = (c, i) => (i === 0 ? '0' : 'n_' + c.nodes[i].toLowerCase());
const num = (x) => Number(x).toPrecision(15);

function netlist(c) {
  const L = [`* ${c.id}`, '.model DX D(IS=1e-14 N=1 RS=1)'];
  for (const el of c.elements) {
    const key = el.id.toLowerCase();
    const ab = `${name(c, el.a)} ${name(c, el.b)}`;
    if (el.kind === 'R') L.push(`R_${key} ${ab} ${num(el.ohms)}`);
    else if (el.kind === 'C') L.push(`C_${key} ${ab} ${num(el.farads)} ic=${num(el.v0 ?? 0)}`);
    else if (el.kind === 'L') L.push(`L_${key} ${ab} ${num(el.henries)} ic=${num(el.i0 ?? 0)}`);
    else if (el.kind === 'V') L.push(`V_${key} ${ab} DC ${num(el.volts)}`);
    else if (el.kind === 'VW') L.push(`V_${key} ${ab} SIN(${num(el.offsetV)} ${num(el.amplitudeV)} ${num(el.hz)})`);
    else if (el.kind === 'D') L.push(`D_${key} ${ab} DX`);
  }
  L.push('.options reltol=1e-6 abstol=1e-14 vntol=1e-9 gmin=1e-12', `.tran ${num(STEP)} ${num(c.stopSeconds)} 0 ${num(STEP)} uic`, '.end');
  return L.join('\n');
}

// the traces on a uniform grid, by linear interpolation of ngspice's own time points (at most one step apart)
function resample(times, values, stop) {
  const trace = [];
  let k = 0;
  for (let t = 0; t <= stop + 1e-12; t += GRID) {
    while (k + 1 < times.length && times[k + 1] < t) k++;
    const k1 = Math.min(k + 1, times.length - 1);
    const span = times[k1] - times[k];
    const w = span > 0 ? Math.min(1, Math.max(0, (t - times[k]) / span)) : 0;
    trace.push(values[k] + w * (values[k1] - values[k]));
  }
  return trace;
}

const { Simulation } = await import(pathToFileURL(resolve(engineDir, 'dist/eecircuit-engine.mjs')).href);
const sim = new Simulation();
await sim.start();

const cases = [];
for (const c of CASES) {
  sim.setNetList(netlist(c));
  const result = await sim.runSim();
  const by = Object.fromEntries(result.data.map((d) => [d.name.toLowerCase(), d.values]));
  const traces = {};
  for (let i = 1; i < c.nodes.length; i++) traces[c.nodes[i]] = resample(by.time, by['v(n_' + c.nodes[i].toLowerCase() + ')'], c.stopSeconds);
  cases.push({ id: c.id, revision: ENGINE, stepSeconds: STEP, gridSeconds: GRID, nodes: c.nodes, elements: c.elements, traces });
}

const text = JSON.stringify({ engine: ENGINE, generatedBy: 'scripts/gen-ngspice-transient.mjs', cases }, null, 1) + '\n';
if (args.includes('--check')) {
  if (readFileSync(out, 'utf8') !== text) { console.error(`${out} is out of date; regenerate it`); process.exit(1); }
  console.log(`${out} matches`);
} else {
  writeFileSync(out, text);
  console.log(`wrote ${cases.length} cases to ${out}`);
}
process.exit(0);
