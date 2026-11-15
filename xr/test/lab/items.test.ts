import { describe, expect, it } from 'vitest';
import { createLabContext } from '../../src/lab/context';
import { actionOf, CONTROLS } from '../../src/lab/items/controls';
import { channelsOf, levelMm, liveChannels } from '../../src/lab/items/channels';
import { REFUSALS } from '../../src/lab/model/catalogue';
import { KINDS, MODELS } from '../../src/lab/model/registry';
import { isRefusal, NO_ENV } from '../../src/lab/model/types';
import { LAB_LAYOUTS } from '../../src/lab/experiments/list';

describe('item controls', () => {
  it('every real kind has controls, and each one sends an action its model accepts or refuses with a known reason', () => {
    for (const kind of KINDS) {
      const specs = CONTROLS[kind];
      expect(specs?.length, kind).toBeGreaterThan(0);
      const m = MODELS[kind]!;
      const st = m.init();
      for (const spec of specs!) {
        for (const half of spec.knob ? ([-1, 1] as const) : [undefined]) {
          const action = actionOf(spec, st, half)!;
          expect(action, `${kind}/${spec.id}`).not.toBeNull();
          expect(m.actions.includes(action.type), `${kind}/${spec.id} -> ${action.type}`).toBe(true);
          const r = m.apply(st, action, NO_ENV);
          if (isRefusal(r)) expect(REFUSALS[r.reason], `${kind}/${spec.id}: ${r.reason}`).toBeDefined();
        }
      }
    }
  });

  it('controls sit within reach of their item (inside the foot, give or take the bench pads)', () => {
    for (const kind of KINDS) {
      const [w, d, h] = MODELS[kind]!.foot.map((v) => v / 1000);
      for (const spec of CONTROLS[kind]!) {
        if (spec.node) continue;
        expect(Math.abs(spec.at[0]), `${kind}/${spec.id} x`).toBeLessThanOrEqual(w / 2 + 0.03);
        expect(Math.abs(spec.at[2]), `${kind}/${spec.id} z`).toBeLessThanOrEqual(d / 2 + 0.03);
        expect(spec.at[1], `${kind}/${spec.id} y`).toBeLessThanOrEqual(h);
      }
    }
  });
});

describe('channels', () => {
  it('drive the figures’ channel ids from model state', () => {
    const b = MODELS['bunsen-burner']!;
    const lit = b.apply(b.apply(b.init(), { type: 'gas' }, NO_ENV) as never, { type: 'light' }, NO_ENV) as never;
    const ch = Object.fromEntries(channelsOf('bunsen-burner', lit, b.report(lit, NO_ENV), NO_ENV));
    expect(ch).toMatchObject({ 'turn:COLLAR': 0, 'turn:TAP': 0, 'flame:BURNER': 1, 'height:FLAME': 105 });
    const s = MODELS['bench-power-supply']!;
    const st = s.init({ vSet: 30, iSet: 5 });
    const sc = Object.fromEntries(channelsOf('bench-power-supply', st, s.report(st, NO_ENV), NO_ENV));
    expect(sc['turn:VSET']).toBe(150);
    expect(sc['turn:ISET']).toBe(150);
    expect(sc['press:POWER']).toBe(12);
    expect(levelMm([[0, 2], [50, 16.2]], 25)).toBeCloseTo(9.1);
  });

  it('a salt in the flame tints the burner’s flame', () => {
    const ctx = createLabContext(() => 'en');
    ctx.open('chemistry');
    const burner = ctx.store.byKind('bunsen-burner')!.id;
    const kit = ctx.store.byKind('flame-test-kit')!.id;
    ctx.store.apply(burner, { type: 'gas' });
    ctx.store.apply(burner, { type: 'light' });
    ctx.store.apply(burner, { type: 'collar', value: 'half' });
    ctx.store.apply(kit, { type: 'dip-salt', value: 'Cu' });
    ctx.store.apply(kit, { type: 'to-flame' });
    for (let i = 0; i < 20; i++) ctx.frame(50);
    const tint = () => Object.fromEntries(channelsOf('bunsen-burner', ctx.store.get(burner)!.state, ctx.store.report(burner)!, ctx.store))['tint:FLAME'];
    expect(tint()).toBe('#1fbf9a'); // copper: blue-green
    // Straight into strontium without cleaning: the two mix, and sodium's yellow swamps both.
    ctx.store.apply(kit, { type: 'dip-salt', value: 'Sr' });
    ctx.store.apply(kit, { type: 'to-flame' });
    for (let i = 0; i < 20; i++) ctx.frame(50);
    expect(tint()).toBe('#ffb11a');
    expect(ctx.store.mistake(kit)).toBe('dirty-loop');
  });

  it('live channels allocate nothing and move the pendulum', () => {
    const p = MODELS['pendulum-stand']!;
    const st = p.apply(p.init(), { type: 'swing' }, NO_ENV) as never;
    const seen: Array<[string, number]> = [];
    liveChannels('pendulum-stand', st, (c, v) => seen.push([c, v]));
    expect(seen).toEqual([['swing:BOB', 10]]);
  });
});

describe('lab context', () => {
  it('opens each lab with its layout, leaves cleanly, starts experiments, places a stand-in', () => {
    const ctx = createLabContext(() => 'de');
    for (const lab of ['chemistry', 'physics', 'electrical', 'signals'] as const) {
      ctx.open(lab);
      expect(ctx.store.lab).toBe(lab);
      expect(ctx.store.items().map((i) => i.kind)).toEqual(LAB_LAYOUTS[lab].map((k) => k.kind));
    }
    expect(ctx.start('chemistry/flame-test', 'exam', 3)).toBe(true);
    expect(ctx.runner.state.value?.mode).toBe('exam');
    expect(ctx.start('nope')).toBe(false);
    const r = ctx.request('Abzugshaube');
    expect(r).toMatchObject({ found: false, kind: 'generic', placeholder: true, name: 'Abzugshaube' });
    expect(ctx.store.get(r.id)).toMatchObject({ kind: 'generic', label: 'Abzugshaube', placeholder: true });
    expect(ctx.feed.snapshot().items.find((i) => i.id === r.id)).toMatchObject({ name: 'Abzugshaube', placeholder: true });
    ctx.leave();
    expect(ctx.store.lab).toBeNull();
    expect(ctx.store.items()).toHaveLength(0);
    expect(ctx.runner.state.value).toBeNull();
    // The clock only runs while a lab is open.
    const before = ctx.store.now;
    ctx.frame(100);
    expect(ctx.store.now).toBe(before);
  });
});
