/** Ghost fit through iynk's rule (bench/core/fit.ts) and seating at it (actions.ts `seatPart`), on the Uno Blink template. */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { builtinRegistry } from '@/parts/builtin';
import { stateHash } from '@/project/hash';
import { validateValue } from '@/project/validate';
import { resolvePart } from '@/studio/parts-view';
import type { IdSource } from '@/studio/views/breadboard';
import type { Project, ProjectStore } from '../src/contracts/project';
import { createProjectStore, createTemplateSource } from '../src/project/store';
import { seatPart, type ActionResult } from '../src/bench/core/actions';
import { PITCH_M } from '../src/bench/core/cells';
import { checkFit, createGhostFit, GHOST_HEIGHT_WORK_M, type GhostFit } from '../src/bench/core/fit';

const registry = builtinRegistry();
const S = 3;
const TOP = 0;
let template: Project;
let doc: Project;

beforeAll(async () => {
  template = await createTemplateSource().load('prj_uno-r3-blink');
});
beforeEach(() => {
  doc = template;
});

/** A hole of the template's breadboard (BB1 at 0, 0) in the board frame. */
function hole(name: string): { x: number; z: number } {
  const pin = resolvePart(doc, 'core.breadboard-half', registry).pins.find((p) => p.id === name)!;
  return { x: pin.xMm / 1000, z: pin.yMm / 1000 };
}

const ghostOf = (ref: string, extra: { part?: string; rotation?: 0 | 90 | 180 | 270 } = {}): GhostFit =>
  createGhostFit(doc, { ref, ...extra }, { topY: TOP, registry, steady: false })!;

/** One frame with the anchor leg's tip over `name`, `dx` pitches to the right, its lowest tip `height` above the top. */
const over = (g: GhostFit, name: string, dx = 0, height = 0.01 / S, t = 0) => {
  const h = hole(name);
  return g.update(t, h.x + dx * PITCH_M, TOP + height, h.z, TOP + height, S);
};

describe('when the ghost shows', () => {
  it('shows within 0.025 m of work of the top face and over the grid, and not otherwise', () => {
    const g = ghostOf('core.led-5mm');
    expect(g.anchorPin).toBe('A');
    expect(over(g, 'b20', 0, 0.03 / S).shown).toBe(false);
    const s = over(g, 'b20', 0, 0.02 / S);
    expect([s.shown, s.changed, s.fit?.anchorHole]).toEqual([true, true, 'b20']);
    expect(over(g, 'b20', 0, GHOST_HEIGHT_WORK_M / S - 1e-9).changed).toBe(false);
    expect(g.update(0, -0.05, 0.001, 0.02, 0.001, S).shown).toBe(false);
    expect(g.state.changed).toBe(true);
    expect(g.state.fit).toBeNull();
  });

  it('does not make a ghost for a board', () => {
    expect(createGhostFit(doc, { ref: 'core.uno-r3' }, { registry })).toBeNull();
    expect(createGhostFit(doc, { part: 'cmp_bb' }, { registry })).toBeNull();
  });
});

describe('the fit and the legs', () => {
  it('seats an LED on free holes with every leg free', () => {
    const s = over(ghostOf('core.led-5mm'), 'b20');
    expect(s.fit).toMatchObject({ anchorHole: 'b20', rotation: 0, legs: { A: 'b20', K: 'b21' } });
    expect(s.legs).toEqual([
      { pin: 'A', hole: 'b20', state: 'free' },
      { pin: 'K', hole: 'b21', state: 'free' },
    ]);
    expect(s.problem).toBeNull();
  });

  it('names the taken hole and its holder for the first failing leg, and fits next to it', () => {
    const s = over(ghostOf('core.led-5mm'), 'b13');
    expect(s.legs[0]).toEqual({ pin: 'A', hole: 'b13', state: 'free' });
    expect(s.problem).toEqual({ pin: 'K', hole: 'b14', state: 'taken', holder: 'cmp_res1', holderRefdes: 'RES1' });
    expect(s.fit).not.toBeNull();
    expect(Object.values(s.fit!.legs)).not.toContain('b14');
    const onLed = over(ghostOf('core.led-5mm'), 'c15');
    expect(onLed.problem).toMatchObject({ pin: 'A', hole: 'c15', state: 'taken', holderRefdes: 'LED1' });
  });

  it('lets a part being moved use the holes it holds', () => {
    const s = over(ghostOf('core.led-5mm', { part: 'cmp_led1' }), 'c15');
    expect(s.problem).toBeNull();
    expect(s.fit?.legs).toEqual({ A: 'c15', K: 'c16' });
  });

  it('reports a two-leg part across one strip as same row (iynk still seats such a part; only chips are refused)', () => {
    // turned 270, K sits one row below A: d20 and e20 are one strip
    const s = over(ghostOf('core.led-5mm', { rotation: 270 }), 'd20');
    expect(s.problem).toEqual({ pin: 'K', hole: 'e20', state: 'same-strip', with: 'A', withHole: 'd20' });
    expect(s.fit?.anchorHole).toBe('d20');
  });

  it('says a leg off the end of the board is off the grid', () => {
    const s = over(ghostOf('core.led-5mm'), 'j30');
    expect(s.problem).toEqual({ pin: 'K', hole: null, state: 'off-grid' });
    expect(s.fit?.anchorHole).not.toBe('j30');
  });

  it('fits a DIP chip held over one side of the centre channel across it', () => {
    const s = over(ghostOf('core.ne555'), 'd22');
    // under the anchor the top row lands in rows a to d: CONT shares RESET's strip
    expect(s.problem).toMatchObject({ pin: 'CONT', state: 'same-strip', with: 'RESET' });
    expect(s.fit?.legs).toEqual({ GND: 'f22', TRIG: 'f23', OUT: 'f24', RESET: 'f25', CONT: 'e25', THRES: 'e24', DISCH: 'e23', VCC: 'e22' });
  });
});

describe('hysteresis', () => {
  it('keeps the current fit until a new best is nearer by 0.35 pitch, both ways', () => {
    const g = ghostOf('core.led-5mm');
    expect(over(g, 'b20').fit?.anchorHole).toBe('b20');
    // 0.6 pitch along, b21 is nearest but only 0.2 pitch nearer
    expect(over(g, 'b20', 0.6).anchorHole).toBe('b21');
    expect([g.state.fit?.anchorHole, g.state.changed]).toEqual(['b20', false]);
    expect(over(g, 'b20', 0.66).fit?.anchorHole).toBe('b20');
    // 0.7 along it is 0.4 nearer
    expect([over(g, 'b20', 0.7).fit?.anchorHole, g.state.changed]).toEqual(['b21', true]);
    expect(over(g, 'b20', 0.4).fit?.anchorHole).toBe('b21');
    expect(over(g, 'b20', 0.3).fit?.anchorHole).toBe('b20');
  });

  it('holds still under hand jitter with the steadying on', () => {
    const g = createGhostFit(doc, { ref: 'core.led-5mm' }, { topY: TOP, registry })!;
    const h = hole('b20');
    let changes = 0;
    for (let f = 0; f < 180; f++) {
      // 1.5 mm of tremor, 0.6 pitch, either way along the row
      const j = 0.0015 * Math.sin(f * 2.3);
      g.update(f / 90, h.x + j, 0.002, h.z, 0.002, S);
      if (g.state.changed) changes++;
    }
    expect([g.state.fit?.anchorHole, changes]).toEqual(['b20', 1]);
  });

  it('drops the fit when the part is turned and finds the new one', () => {
    const g = ghostOf('core.led-5mm');
    over(g, 'b20');
    g.setRotation(90);
    const s = over(g, 'b20');
    expect([s.changed, s.fit?.rotation, s.fit?.legs]).toEqual([true, 90, { A: 'b20', K: 'a20' }]);
  });
});

describe('seating at the fit', () => {
  let store: ProjectStore;
  let n = 0;
  const ids = ((prefix: string) => `${prefix}_s${++n}`) as IdSource;
  beforeEach(() => {
    store = createProjectStore(template, registry);
  });

  function commit<X extends object>(r: ActionResult<X>) {
    if (!r.ok) throw new Error(`${r.reason} ${JSON.stringify(r.args)}`);
    const before = stateHash(store.doc);
    expect(store.apply(r.ops, { label: r.label }).ok).toBe(true);
    const after = stateHash(store.doc);
    expect(store.undo()?.ok).toBe(true);
    expect(stateHash(store.doc)).toBe(before);
    expect(store.redo()?.ok).toBe(true);
    expect(stateHash(store.doc)).toBe(after);
    return r;
  }
  const legsOf = (c: string) => store.doc.views.find((v) => v.kind === 'breadboard')!.placements.find((p) => p.c === c)?.legs;

  it('seats a new part exactly where its ghost was, turned as it was', () => {
    const g = ghostOf('core.led-5mm', { rotation: 90 });
    const fit = over(g, 'b20').fit!;
    const seated = commit(seatPart(store.doc, { ref: 'core.led-5mm', fit }, { registry, ids }));
    expect(seated.label).toBe('Place D1');
    expect(legsOf(seated.id)).toEqual({ A: 'b20', K: 'a20' });
    expect(store.doc.views[0]!.placements.find((p) => p.c === seated.id)?.rotation_deg).toBe(90);
  });

  it('seats a chip across the channel from its ghost and the project stays valid', () => {
    const fit = over(ghostOf('core.ne555'), 'd22').fit!;
    const seated = commit(seatPart(store.doc, { ref: 'core.ne555', fit }, { registry, ids }));
    expect(legsOf(seated.id)).toMatchObject({ GND: 'f22', VCC: 'e22' });
    const report = validateValue(JSON.parse(JSON.stringify(store.doc)));
    expect(report.ok).toBe(true);
  });

  it('moves a seated part into a fit with its nets', () => {
    const seated = commit(seatPart(store.doc, { part: 'cmp_led1', fit: { anchorHole: 'b20', rotation: 0 } }, { registry, ids }));
    expect(seated.label).toBe('Move LED1');
    expect(legsOf('cmp_led1')).toEqual({ A: 'b20', K: 'b21' });
  });

  it('refuses a fit whose leg is taken, in one strip for a chip, or off the grid, naming the leg', () => {
    expect(seatPart(store.doc, { ref: 'core.led-5mm', fit: { anchorHole: 'b13', rotation: 0 } }, { registry, ids })).toEqual({ ok: false, reason: 'hole-taken', args: { pin: 'K', hole: 'b14', holder: 'RES1' } });
    expect(seatPart(store.doc, { ref: 'core.ne555', fit: { anchorHole: 'd22', rotation: 0 } }, { registry, ids })).toEqual({ ok: false, reason: 'same-strip', args: { a: 'd25', b: 'a25' } });
    expect(seatPart(store.doc, { ref: 'core.led-5mm', fit: { anchorHole: 'j30', rotation: 0 } }, { registry, ids })).toEqual({ ok: false, reason: 'off-grid', args: { pin: 'K' } });
    expect(seatPart(store.doc, { part: 'cmp_led1', fit: { anchorHole: 'c14', rotation: 0 } }, { registry, ids })).toMatchObject({ ok: false, reason: 'unchanged' });
    expect(checkFit(store.doc, { ref: 'core.led-5mm', anchorHole: 'zz9', rotation: 0 }, registry)).toEqual({ ok: false, problem: { pin: 'A', hole: null, state: 'off-grid' } });
    expect(seatPart(store.doc, { ref: 'pack.mystery', fit: { anchorHole: 'b20', rotation: 0 } }, { registry, ids })).toMatchObject({ ok: false, reason: 'unknown-definition' });
  });
});
