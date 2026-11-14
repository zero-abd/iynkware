/** Build actions (bench/core/actions.ts) on iynk's Uno Blink template, applied through the headset's project store. */
import { beforeEach, describe, expect, it } from 'vitest';
import { builtinRegistry } from '@/parts/builtin';
import { stateHash } from '@/project/hash';
import { validateValue } from '@/project/validate';
import { resolvePart } from '@/studio/parts-view';
import type { IdSource } from '@/studio/views/breadboard';
import { LANGS } from '../src/contracts/common';
import type { Project, ProjectStore } from '../src/contracts/project';
import { createProjectStore, createTemplateSource } from '../src/project/store';
import {
  ACTIONS,
  addWire,
  movePart,
  moveWireEnd,
  partOrigin,
  placePart,
  pullPart,
  recolourWire,
  refusalMessageKey,
  refusalText,
  removePart,
  removeWire,
  routeWire,
  runAction,
  straightenWire,
  turnPart,
  type ActionEnv,
  type ActionReason,
  type ActionResult,
  type DocPoint,
} from '../src/bench/core/actions';

const registry = builtinRegistry();
const PITCH = 2.54;
let template: Project;
let store: ProjectStore;
let env: ActionEnv;

/** Deterministic ids: `cmp_t1`, `net_t2`, ... */
function counterIds(): IdSource {
  let n = 0;
  return ((prefix: string) => `${prefix}_t${++n}`) as IdSource;
}

/** The document point of a hole of the template's breadboard (BB1 at 0, 0). */
function hole(doc: Project, name: string): DocPoint {
  const bb = doc.views.find((v) => v.kind === 'breadboard')!.placements.find((p) => p.c === 'cmp_bb')!;
  const pin = resolvePart(doc, 'core.breadboard-half', registry).pins.find((p) => p.id === name)!;
  return { x_mm: bb.x_mm + pin.xMm, y_mm: bb.y_mm + pin.yMm };
}

const view = (doc: Project) => doc.views.find((v) => v.kind === 'breadboard')!;
const placement = (doc: Project, c: string) => view(doc).placements.find((p) => p.c === c);
const wireOf = (doc: Project, id: string) => view(doc).wires.find((w) => w.id === id);

function ok<X extends object>(result: ActionResult<X>): Extract<ActionResult<X>, { ok: true }> {
  if (!result.ok) throw new Error(`refused: ${result.reason} ${JSON.stringify(result.args)}`);
  return result as Extract<ActionResult<X>, { ok: true }>;
}

/** Applies an action's ops as one store call, then checks it is one undo and that redo brings it back. */
function commit<X extends object>(result: ActionResult<X>): Extract<ActionResult<X>, { ok: true }> {
  const done = ok(result);
  const before = stateHash(store.doc);
  const applied = store.apply(done.ops, { label: done.label });
  if (!applied.ok) throw new Error(`${applied.reject}: ${applied.message}`);
  const after = stateHash(store.doc);
  expect(after).not.toBe(before);
  expect(store.undo()?.ok).toBe(true);
  expect(stateHash(store.doc)).toBe(before);
  expect(store.redo()?.ok).toBe(true);
  expect(stateHash(store.doc)).toBe(after);
  return done;
}

function refused<X extends object>(result: ActionResult<X>, reason: ActionReason) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('not refused');
  expect(result.reason).toBe(reason);
  return result;
}

const valid = (doc: Project) => {
  const report = validateValue(JSON.parse(JSON.stringify(doc)));
  expect(report.diagnostics?.filter((d) => d.severity === 'error') ?? []).toEqual([]);
  expect(report.ok).toBe(true);
  // it opens unchanged: what the validator reads back is the same document
  expect(stateHash(report.doc!)).toBe(stateHash(doc));
};

beforeEach(async () => {
  template ??= await createTemplateSource().load('prj_uno-r3-blink');
  store = createProjectStore(template, registry);
  env = { registry, ids: counterIds() };
});

describe('place', () => {
  it('seats a new LED in the holes under its first leg, as the 2D Studio names it', () => {
    const placed = commit(placePart(store.doc, { ref: 'core.led-5mm', at: hole(store.doc, 'b20') }, env));
    expect(placed.label).toBe('Place D1');
    expect([placed.refdes, placed.loose, placed.chip]).toEqual(['D1', false, false]);
    expect(placement(store.doc, placed.id)?.legs).toEqual({ A: 'b20', K: 'b21' });
  });

  it('places a resistor as R1 four columns wide and pins nothing twice', () => {
    const placed = commit(placePart(store.doc, { ref: 'core.resistor', at: hole(store.doc, 'a3') }, env));
    expect(placed.label).toBe('Place R1');
    expect(placement(store.doc, placed.id)?.legs).toEqual({ P1: 'a3', P2: 'a7' });
    expect(placed.ops.some((op) => op.k === 'dep.set')).toBe(false);
  });

  it('never seats a leg in a taken hole: over LED1 it finds the nearest free fit', () => {
    const placed = commit(placePart(store.doc, { ref: 'core.led-5mm', at: hole(store.doc, 'c14') }, env));
    const legs = Object.values(placement(store.doc, placed.id)?.legs ?? {});
    expect(legs).toHaveLength(2);
    for (const taken of ['c14', 'c15', 'b10', 'b14', 'a10', 'a15']) expect(legs).not.toContain(taken);
  });

  it('lays a part loose off the breadboard and a chip across the channel', () => {
    const loose = commit(placePart(store.doc, { ref: 'core.led-5mm', at: { x_mm: 30, y_mm: 120 } }, env));
    expect(loose.loose).toBe(true);
    expect(placement(store.doc, loose.id)?.legs).toBeUndefined();
    const chip = commit(placePart(store.doc, { ref: 'core.ne555', at: hole(store.doc, 'd22') }, env));
    expect(chip.chip).toBe(true);
    expect(placement(store.doc, chip.id)?.legs).toMatchObject({ GND: 'f22', VCC: 'e22' });
  });

  it('refuses a part the library does not hold', () => {
    refused(placePart(store.doc, { ref: 'pack.mystery', at: { x_mm: 0, y_mm: 0 } }, env), 'unknown-definition');
  });
});

describe('move, pull and turn', () => {
  it('moves a seated part five columns along and its legs follow', () => {
    const at = partOrigin(store.doc, 'cmp_led1')!;
    const moved = commit(movePart(store.doc, { part: 'cmp_led1', to: { x_mm: at.x_mm + 5 * PITCH, y_mm: at.y_mm } }, env));
    expect(moved.label).toBe('Move LED1');
    expect(moved.seated).toBe(true);
    expect(placement(store.doc, 'cmp_led1')?.legs).toEqual({ A: 'c19', K: 'c20' });
  });

  it('lays a part loose when asked, letting go of its strips', () => {
    const at = partOrigin(store.doc, 'cmp_led1')!;
    const moved = commit(movePart(store.doc, { part: 'cmp_led1', to: { x_mm: at.x_mm + 5 * PITCH, y_mm: at.y_mm }, seat: false }, env));
    expect([moved.seated, moved.unseated]).toEqual([false, true]);
    expect(placement(store.doc, 'cmp_led1')?.legs).toBeUndefined();
    // A reached RES1's P2 only through strip 14, so the two are no longer one net
    const together = store.doc.nets.some((n) => n.connections.some((c) => c.c === 'cmp_led1' && c.p === 'A') && n.connections.some((c) => c.c === 'cmp_res1' && c.p === 'P2'));
    expect(together).toBe(false);
  });

  it('moves a board with a plain placement', () => {
    const moved = commit(movePart(store.doc, { part: 'brd_main', to: { x_mm: -100, y_mm: 10 } }, env));
    expect(moved.ops).toEqual([{ k: 'view.place', view: 'vw_bb', placement: { c: 'brd_main', x_mm: -100, y_mm: 10 } }]);
    refused(movePart(store.doc, { part: 'brd_main', to: { x_mm: -100, y_mm: 10 } }, env), 'unchanged');
  });

  it('pulls a seated part out where it is and refuses a part in no holes', () => {
    const at = partOrigin(store.doc, 'cmp_res1')!;
    const pulled = commit(pullPart(store.doc, { part: 'cmp_res1' }, env));
    expect(pulled.label).toBe('Pull out RES1');
    expect(placement(store.doc, 'cmp_res1')).toMatchObject({ x_mm: at.x_mm, y_mm: at.y_mm });
    expect(placement(store.doc, 'cmp_res1')?.legs).toBeUndefined();
    refused(pullPart(store.doc, { part: 'cmp_res1' }, env), 'not-seated');
    refused(pullPart(store.doc, { part: 'cmp_nobody' }, env), 'unknown-part');
  });

  it('turns a seated part about its first leg, and refuses a turn onto a taken hole', () => {
    // K one row down from A: d14 is free; one row up is b14, where RES1 stands
    const turned = commit(turnPart(store.doc, { part: 'cmp_led1', deg: 270 }, env));
    expect(turned.label).toBe('Rotate LED1');
    expect(placement(store.doc, 'cmp_led1')).toMatchObject({ rotation_deg: 270, legs: { A: 'c14', K: 'd14' } });
    store.undo();
    const blocked = refused(turnPart(store.doc, { part: 'cmp_led1', deg: 90 }, env), 'rotate-blocked');
    expect(refusalText('en', blocked)).toBe('LED1 did not turn: the turned legs would not land on free holes. Move it first, or free the holes it needs.');
  });

  it('turns a board in 15 degree steps', () => {
    commit(turnPart(store.doc, { part: 'brd_main', step: 1 }, env));
    expect(placement(store.doc, 'brd_main')?.rotation_deg).toBe(15);
    commit(turnPart(store.doc, { part: 'brd_main', step: -1 }, env));
    expect(placement(store.doc, 'brd_main')?.rotation_deg).toBe(0);
    refused(turnPart(store.doc, { part: 'brd_main', deg: 20 }, env), 'bad-rotation');
    refused(turnPart(store.doc, { part: 'cmp_led1', deg: 45 }, env), 'bad-rotation');
  });
});

describe('remove a part', () => {
  it('takes the part, its wires and its connections in one batch, as the Studio deletes', () => {
    const removed = commit(removePart(store.doc, { part: 'cmp_led1' }, env));
    expect(removed.label).toBe('Delete LED1');
    expect(store.doc.components.some((c) => c.id === 'cmp_led1')).toBe(false);
    expect(store.doc.nets.some((n) => n.connections.some((c) => c.c === 'cmp_led1'))).toBe(false);
    valid(store.doc);
  });

  it('keeps the only board', () => {
    const r = refused(removePart(store.doc, { part: 'brd_main' }, env), 'last-board');
    expect(refusalText('de', r)).toBe('Das einzige Board des Projekts lässt sich nicht löschen.');
  });
});

describe('wires', () => {
  it('adds a wire from a pin to a hole with its net, coloured as the Studio colours it', () => {
    const made = commit(addWire(store.doc, { from: { kind: 'pin', c: 'brd_main', p: 'D12' }, to: { kind: 'hole', surface: 'cmp_bb', hole: 'a20' } }, env));
    expect(made.label).toBe('Wire U1.D12 to a20');
    // two wires already, so the third of blue, green, yellow, ...
    expect(wireOf(store.doc, made.wire)?.color).toBe('yellow');
    expect(store.doc.nets.some((n) => n.connections.some((c) => c.c === 'brd_main' && c.p === 'D12'))).toBe(true);
  });

  it('refuses the same strip, a duplicate wire and the same pin with iynk codes', () => {
    const strip = refused(addWire(store.doc, { from: { kind: 'hole', surface: 'cmp_bb', hole: 'a10' }, to: { kind: 'hole', surface: 'cmp_bb', hole: 'e10' } }, env), 'same-strip');
    expect(strip.args).toEqual({ a: 'a10', b: 'e10' });
    expect(refusalText('en', strip)).toBe('a10 and e10 are already connected inside the breadboard.');
    const twice = refused(addWire(store.doc, { from: { kind: 'pin', c: 'brd_main', p: 'D13' }, to: { kind: 'hole', surface: 'cmp_bb', hole: 'a10' } }, env), 'duplicate-wire');
    expect(twice.args).toEqual({ a: 'U1.D13', b: 'a10' });
    const pin = { kind: 'pin', c: 'brd_main', p: 'D7' } as const;
    refused(addWire(store.doc, { from: pin, to: pin }, env), 'same-pin');
    refused(addWire(store.doc, { from: pin, to: { kind: 'pin', c: 'brd_main', p: 'NOPE' } }, env), 'no-such-pin');
  });

  it('moves one wire end to another hole, keeping its id and colour', () => {
    const moved = commit(moveWireEnd(store.doc, { wire: 'wir_1', end: 'to', to: { kind: 'hole', surface: 'cmp_bb', hole: 'a12' } }, env));
    expect(moved.label).toBe('Move wire end to a12');
    expect(wireOf(store.doc, 'wir_1')).toMatchObject({ color: 'orange', from: { kind: 'pin', c: 'brd_main', p: 'D13' }, to: { kind: 'hole', hole: 'a12' } });
    // D13 no longer reaches RES1 through strip 10
    const d13 = store.doc.nets.find((n) => n.connections.some((c) => c.c === 'brd_main' && c.p === 'D13'))!;
    expect(d13.connections.some((c) => c.c === 'cmp_res1')).toBe(false);
    valid(store.doc);
    refused(moveWireEnd(store.doc, { wire: 'wir_1', end: 'to', to: { kind: 'hole', surface: 'cmp_bb', hole: 'a12' } }, env), 'unchanged');
    refused(moveWireEnd(store.doc, { wire: 'wir_1', end: 'to', to: { kind: 'pin', c: 'brd_main', p: 'D13' } }, env), 'same-pin');
  });

  it('recolours a wire with one of the ten colours', () => {
    const painted = commit(recolourWire(store.doc, { wire: 'wir_1', color: 'blue' }, env));
    expect(painted.label).toBe('Colour wire wir_1');
    expect(wireOf(store.doc, 'wir_1')?.color).toBe('blue');
    refused(recolourWire(store.doc, { wire: 'wir_1', color: 'blue' }, env), 'unchanged');
    refused(recolourWire(store.doc, { wire: 'wir_1', color: 'pink' as never }, env), 'bad-color');
  });

  it('routes a wire through at most four bends and straightens it', () => {
    const routed = commit(routeWire(store.doc, { wire: 'wir_2', route_mm: [[-20, 30], [5.555, 30]] }, env));
    expect(routed.label).toBe('Route wire U1.GND to a15');
    expect(wireOf(store.doc, 'wir_2')?.route_mm).toEqual([[-20, 30], [5.56, 30]]);
    refused(routeWire(store.doc, { wire: 'wir_2', route_mm: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] }, env), 'too-many-bends');
    const straight = commit(straightenWire(store.doc, { wire: 'wir_2' }, env));
    expect(straight.label).toBe('Straighten wire U1.GND to a15');
    expect(wireOf(store.doc, 'wir_2')?.route_mm).toBeUndefined();
    refused(straightenWire(store.doc, { wire: 'wir_2' }, env), 'unchanged');
  });

  it('removes a wire and cuts its net where it was the only link', () => {
    const removed = commit(removeWire(store.doc, { wire: 'wir_2' }, env));
    expect(removed.label).toBe('Delete wire');
    const gnd = store.doc.nets.find((n) => n.id === 'net_gnd');
    expect(gnd?.connections.some((c) => c.c === 'cmp_led1') && gnd.connections.some((c) => c.c === 'brd_main')).toBeFalsy();
    refused(removeWire(store.doc, { wire: 'wir_2' }, env), 'unknown-wire');
  });
});

describe('the co-builder seam', () => {
  it('builds a circuit with actions alone that validates and opens unchanged in the Studio', () => {
    const step = <X extends object>(r: ActionResult<X>) => {
      const done = ok(r);
      const applied = store.apply(done.ops, { label: done.label });
      if (!applied.ok) throw new Error(`${done.label}: ${applied.reject} ${applied.message}`);
      return done;
    };
    const led = step(placePart(store.doc, { ref: 'core.led-5mm', at: hole(store.doc, 'e25') }, env));
    const res = step(placePart(store.doc, { ref: 'core.resistor', at: hole(store.doc, 'a21') }, env));
    const w1 = step(addWire(store.doc, { from: { kind: 'pin', c: 'brd_main', p: 'D9' }, to: { kind: 'hole', surface: 'cmp_bb', hole: 'b21' } }, env));
    step(addWire(store.doc, { from: { kind: 'hole', surface: 'cmp_bb', hole: 'd26' }, to: { kind: 'hole', surface: 'cmp_bb', hole: 'd15' } }, env));
    step(turnPart(store.doc, { part: led.id, deg: 180 }, env));
    step(routeWire(store.doc, { wire: w1.wire, route_mm: [[-30, 40]] }, env));
    step(recolourWire(store.doc, { wire: w1.wire, color: 'white' }, env));
    step(moveWireEnd(store.doc, { wire: w1.wire, end: 'to', to: { kind: 'hole', surface: 'cmp_bb', hole: 'c21' } }, env));
    const at = partOrigin(store.doc, res.id)!;
    step(movePart(store.doc, { part: res.id, to: { x_mm: at.x_mm, y_mm: at.y_mm + PITCH } }, env));
    step(pullPart(store.doc, { part: 'cmp_res1' }, env));
    step(removePart(store.doc, { part: 'cmp_res1' }, env));
    valid(store.doc);
    expect(store.doc.components.map((c) => c.refdes).sort()).toEqual(['BB1', 'D1', 'LED1', 'R1']);
  });

  it('lists every action and calls each one by name', () => {
    expect(ACTIONS.map((a) => a.name)).toEqual(['placePart', 'seatPart', 'movePart', 'pullPart', 'turnPart', 'removePart', 'addWire', 'moveWireEnd', 'recolourWire', 'routeWire', 'straightenWire', 'removeWire']);
    for (const a of ACTIONS) expect(a.does.length).toBeGreaterThan(10);
    const placed = runAction(store.doc, 'placePart', { ref: 'core.led-5mm', at: hole(store.doc, 'b20') }, env);
    expect(placed.ok && placed.label).toBe('Place D1');
    expect(runAction(store.doc, 'launchRocket', {}, env)).toEqual({ ok: false, reason: 'bad-args', args: { action: 'launchRocket' } });
    expect(runAction(store.doc, 'addWire', { from: 'D13' }, env)).toMatchObject({ ok: false, reason: 'bad-args' });
  });

  it('refuses everything on a read-only or viewer open', () => {
    refused(placePart(store.doc, { ref: 'core.led-5mm', at: hole(store.doc, 'b20') }, { ...env, access: 'read-only' }), 'read-only');
    refused(removeWire(store.doc, { wire: 'wir_1' }, { ...env, access: 'viewer' }), 'permission');
  });

  it("words every iynk refusal in all six languages with iynk's messages", () => {
    const codes: ActionReason[] = ['same-pin', 'no-such-pin', 'mechanical-pin', 'not-on-view', 'hole-not-on-surface', 'same-strip', 'duplicate-wire', 'empty-target', 'quota', 'permission', 'read-only', 'unknown-definition', 'board-view', 'last-board', 'rotate-blocked'];
    for (const lang of LANGS) {
      for (const reason of codes) {
        const text = refusalText(lang, { reason, args: { end: 'U1.D13', part: 'LED1', hole: 'a1', a: 'a1', b: 'a2', limit: '400', refdes: 'R1' } });
        expect(text, `${lang} ${reason}`).toBeTruthy();
        expect(text, `${lang} ${reason}`).not.toMatch(/\{\w+\}/);
      }
    }
    expect(refusalMessageKey({ reason: 'quota', args: {} })).toEqual({ ns: 'studioEdit', key: 'edit.place.quota' });
    expect(refusalText('fr', { reason: 'unchanged', args: {} })).toBeNull();
  });
});
