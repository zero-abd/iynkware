/**
 * Keeps the ported bench rules in step with the figures: each `figures/drones/<id>.js` is evaluated in Node with stub
 * drawing helpers (the craft files are one IIFE calling `SL.drone.define`), with the engine (`drone.js`, for `MSG` and
 * `LOG`) and the frame layouts (`drone-frames.js`, for `motorsOf`), and compared with `BENCH_CRAFTS`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../vite.aliases';
import { BENCH_CRAFTS, BENCH_LOG, BENCH_MSG } from '../src/range/flight/model';

type Def = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function loadFigures() {
  const stub: any = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : stub), apply: () => stub }); // eslint-disable-line @typescript-eslint/no-explicit-any
  let captured: Def | null = null;
  const ctx: Record<string, unknown> = { console, CF_T: (s: string) => s, CF_NOTE: () => {}, CF_LANG: 'en' };
  ctx.window = ctx;
  vm.createContext(ctx);
  // the Colorfigures core's globals are drawing helpers: stub each one a file asks for
  const run = (file: string) => {
    const code = readFileSync(`${repoRoot}figures/${file}`, 'utf8');
    for (let i = 0; i < 200; i++) {
      try {
        return vm.runInContext(code, ctx);
      } catch (e) {
        const m = /^(\w+) is not defined$/.exec((e as Error).message);
        if (!((e as Error).name === 'ReferenceError' && m)) throw e;
        ctx[m[1]] = stub;
      }
    }
  };
  run('engine/drone.js');
  const SD = (ctx.SL as { drone: Def }).drone;
  SD.g = stub;
  SD.W = (...a: number[]) => a;
  run('engine/drone-frames.js');
  SD.define = (c: Def) => void (captured = c);
  const crafts: Record<string, Def> = {};
  for (const f of readdirSync(`${repoRoot}figures/drones`).filter((x) => x.endsWith('.js'))) {
    captured = null;
    run(`drones/${f}`);
    if (captured) crafts[(captured as Def).id] = captured;
  }
  return { SD, crafts };
}

describe('the bench rules match the figures', () => {
  const { SD, crafts } = loadFigures();

  it('the engine messages are the figure engine’s', () => {
    expect(BENCH_MSG).toEqual(SD.MSG);
    expect(BENCH_LOG).toEqual(SD.LOG);
  });

  it('every craft with a figure is ported, with the same parts, rules, tests, motors and wording', () => {
    expect(Object.keys(BENCH_CRAFTS).sort()).toEqual(Object.keys(crafts).sort());
    for (const [id, c] of Object.entries(crafts)) {
      const mine = BENCH_CRAFTS[id];
      expect(
        mine.parts,
        id,
      ).toEqual(c.parts.map((p: Def) => ({ id: p.id, short: p.short, after: p.after ?? [], polar: !!p.polar, ...(p.mistake ? { mistake: p.mistake } : {}), z: p.z ?? 0 })));
      const tests = Object.fromEntries(['smoke', 'motors', 'calibrate', 'plug'].filter((k) => c.tests[k]).map((k) => [k, c.tests[k].needs ?? []]));
      expect(mine.tests, id).toEqual(tests);
      expect(mine.motors, id).toEqual(SD.motorsOf(c.frame).map((m: Def) => ({ id: m.id, dir: m.dir })));
      expect(mine.messages, id).toEqual(c.messages);
      expect(mine.logs, id).toEqual(c.logs);
      const hv = Object.entries(c.design.batts as Record<string, Def>).filter(([, b]) => b.chem === 'lihv').map(([k]) => k);
      expect(mine.hvBatts ?? [], id).toEqual(hv);
    }
  });
});
