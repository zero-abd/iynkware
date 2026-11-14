#!/usr/bin/env node
// Writes the analog starters (RC charge, 555 blinker, op-amp amplifier, rectifier, Zener regulator).
//
//   node scripts/gen-analog-starters.mjs [--check]
//
// The circuits are in scripts/analog-starters.data.mjs as parts in breadboard holes and jumper wires. The nets are
// worked out here from the strips and rails of the breadboard, so a net always matches the holes it came from.
// Each starter is one project in src/studio/starters/<id>.project.json, in canonical text. `--check` builds them in
// memory and exits 1 when a file differs.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId } from '../src/core/ids.ts';
import { interfaceOf } from '../src/parts/pins.ts';
import { builtinRegistry } from '../src/parts/builtin.ts';
import { holeToPin } from '../src/project/holes.ts';
import { blankProject } from '../src/project/blank.ts';
import { toCanonicalText } from '../src/project/normalize.ts';
import { createSession } from '../src/project/session.ts';
import { createDocStore } from '../src/studio/stores/doc.ts';
import { breadboardBatch } from '../src/studio/views/breadboard.ts';
import { ANALOG_STARTERS } from './analog-starters.data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src', 'studio', 'starters');
const AT = '2026-01-01T00:00:00.000Z';
const ACTOR = 'usr_local';
const UNO_AT = { x: -80, y: 0 };
const VERSION = '1.0.0';
const registry = builtinRegistry();

const seededRandom = (seed) => {
  let n = seed;
  return { bytes: (count) => Uint8Array.from({ length: count }, () => (n = (n * 31 + 7) % 251)) };
};

// The strip a hole belongs to: a column half (a to e, f to j) or one of the four rails.
function stripOf(hole) {
  const rail = /^RAIL_([TB][PN])\d+$/.exec(hole);
  if (rail) return `rail:${rail[1]}`;
  const col = /^([a-j])(\d+)$/.exec(hole);
  if (!col) throw new Error(`${hole} is not a breadboard hole`);
  return `col:${col[2]}${col[1] <= 'e' ? 'u' : 'l'}`;
}

function unoWithBreadboard(title, seed) {
  const blank = blankProject({ board: 'uno', title, locale: 'en', actor: ACTOR, now: AT, id: 'prj_starter' });
  const rnd = seededRandom(seed);
  const doc = createDocStore(createSession({ state: blank, clock: () => Date.parse(blank.meta.updatedAt), rnd }));
  const { batch } = breadboardBatch(registry, (prefix) => newId(prefix, rnd), { x: 0, y: 0 });
  const placeUno = { k: 'view.place', view: 'vw_bb', placement: { c: 'brd_uno', x_mm: UNO_AT.x, y_mm: UNO_AT.y } };
  const done = doc.commit([...batch, placeUno], { label: 'New project' });
  if (!done.ok) throw new Error(`${done.reject}: ${done.message}`);
  return doc.getState().state;
}

class Joined {
  parent = new Map();
  find(k) {
    if (!this.parent.has(k)) this.parent.set(k, k);
    let root = k;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    this.parent.set(k, root);
    return root;
  }
  union(a, b) {
    this.parent.set(this.find(a), this.find(b));
  }
}

function build(spec) {
  const project = unoWithBreadboard(spec.title.en, spec.seed);
  const bb = project.components[0];
  const surface = project.views.find((v) => v.id === 'vw_bb');
  // The document names a rail hole by its pin (RAIL_TP4); the data writes it the way the figure does (T+4).
  const hole = (name) => {
    const pin = holeToPin('half', name);
    if (pin === null || (/^[TB][+-]/.test(name) && pin !== `RAIL_${name[0]}${name[1] === '+' ? 'P' : 'N'}${name.slice(2)}`)) {
      throw new Error(`${spec.id}: the breadboard has no hole ${name}`);
    }
    return pin;
  };

  const taken = new Set();
  const take = (name, owner) => {
    const pin = hole(name);
    if (taken.has(pin)) throw new Error(`${spec.id}: ${owner} uses hole ${name} twice`);
    taken.add(pin);
  };

  const joined = new Joined();
  const members = new Map();
  const attach = (hl, pin) => {
    const key = `hole:${hl}`;
    joined.union(key, `strip:${stripOf(hl)}`);
    members.set(key, pin);
  };

  for (const part of spec.parts) {
    const descriptor = registry.get(part.ref, VERSION);
    if (!descriptor) throw new Error(`${spec.id}: no part ${part.ref}`);
    const id = `cmp_${part.key}`;
    project.components.push({ id, definition: { ref: part.ref, version: VERSION }, refdes: part.refdes, ...(Object.keys(part.params).length ? { params: part.params } : {}) });
    if (!project.dependencies.components.some((d) => d.ref === part.ref)) {
      project.dependencies.components.push({ ref: part.ref, version: VERSION, origin: 'builtin', interface: interfaceOf(descriptor) });
    }
    const pinIds = new Set(descriptor.pins.map((p) => p.id));
    const legs = {};
    for (const [pin, name] of Object.entries(part.legs)) {
      if (!pinIds.has(pin)) throw new Error(`${spec.id}: ${part.ref} has no pin ${pin}`);
      take(name, `${part.refdes}.${pin}`);
      legs[pin] = hole(name);
      attach(legs[pin], { c: id, p: pin });
    }
    if (Object.keys(legs).length !== pinIds.size) throw new Error(`${spec.id}: ${part.refdes} leaves a pin without a hole`);
    surface.placements.push({ c: id, x_mm: 0, y_mm: 0, legs });
  }

  const wires = spec.wires.map((w) => ({ from: w.from.board ? w.from : { hole: hole(w.from.hole) }, to: { hole: hole(w.to) }, color: w.color }));
  const endKey = (end) => (end.board ? `board:${end.board}` : `hole:${end.hole}`);
  spec.wires.forEach((wire, i) => {
    for (const name of [wire.from.hole, wire.to]) {
      if (name) take(name, 'a wire');
    }
    for (const end of [wires[i].from, wires[i].to]) if (end.hole) joined.union(endKey(end), `strip:${stripOf(end.hole)}`);
    joined.union(endKey(wires[i].from), endKey(wires[i].to));
  });

  // Every pin of every net: part pins from their holes, board pins from the wires that start on them.
  const groups = new Map();
  const add = (root, pin) => groups.set(root, [...(groups.get(root) ?? []), pin]);
  for (const [key, pin] of members) add(joined.find(key), pin);
  for (const wire of wires) if (wire.from.board) add(joined.find(endKey(wire.from)), { c: 'brd_uno', p: wire.from.board });

  const nets = [];
  const netOf = new Map();
  for (const [root, pins] of groups) {
    const has = (p) => pins.some((x) => x.c === 'brd_uno' && x.p === p);
    const named = has('P5V') ? { id: 'net_5v', name: '5V', class: 'power' } : has('GND') ? { id: 'net_gnd', name: 'GND', class: 'ground' } : null;
    const sorted = [...pins].sort((a, b) => (a.c + a.p < b.c + b.p ? -1 : 1));
    const first = sorted.find((p) => p.c !== 'brd_uno') ?? sorted[0];
    const net = named ?? { id: `net_${first.c.replace('cmp_', '')}_${first.p.toLowerCase()}`, class: 'signal' };
    nets.push({ ...net, connections: sorted });
    netOf.set(root, net.id);
  }
  project.nets = nets.sort((a, b) => (a.id < b.id ? -1 : 1));

  const colourless = new Set();
  wires.forEach((wire, i) => {
    const net = netOf.get(joined.find(endKey(wire.from)));
    if (!net) colourless.add(i);
    const from = wire.from.board ? { kind: 'pin', c: 'brd_uno', p: wire.from.board } : { kind: 'hole', surface: bb.id, hole: wire.from.hole };
    surface.wires.push({ id: `wir_${i + 1}`, net: net ?? `net_unused${i}`, from, to: { kind: 'hole', surface: bb.id, hole: wire.to.hole }, color: wire.color });
  });
  if (colourless.size) throw new Error(`${spec.id}: wires ${[...colourless].join(', ')} join no part pin`);

  const board = project.boards[0];
  const sketch = project.sources.find((s) => s.id === board.firmware.entry);
  sketch.content = spec.sketch;

  project.id = `prj_starter-${spec.id}`;
  project.meta.title = spec.title.en;
  project.meta.description = spec.description.en;
  project.meta.kind = 'template';
  project.meta.tags = ['uno-r3', 'lesson', 'analog'];
  project.simulation.seed = spec.seed;
  project.simulation.duration_ms = spec.durationMs;
  project.simulation.solver = { engine: 'iynk-mna', options: spec.solver };
  project.provenance.origin = { kind: 'template', template: spec.id };
  project.guide = {
    kind: 'lesson',
    level: 'analog',
    title: spec.title,
    lede: spec.lede,
    steps: spec.steps,
    hints: spec.hints,
    callouts: spec.callouts,
    specs: spec.specs,
  };
  return project;
}

export function render() {
  return Object.fromEntries(ANALOG_STARTERS.map((spec) => [spec.id, `${toCanonicalText(build(spec))}\n`]));
}

export function main(argv) {
  const check = argv.includes('--check');
  if (argv.some((a) => a !== '--check')) {
    console.error('usage: node scripts/gen-analog-starters.mjs [--check]');
    return 2;
  }
  let different = 0;
  for (const [id, text] of Object.entries(render())) {
    const path = join(OUT, `${id}.project.json`);
    if (check) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== text) {
        console.error(`${path} differs from scripts/analog-starters.data.mjs`);
        different++;
      }
    } else {
      writeFileSync(path, text);
    }
  }
  if (!check) console.log(`${ANALOG_STARTERS.length} analog starters written to ${OUT}`);
  return different > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.argv.slice(2));
}
