// @cf title NE555 timer
// @cf use engine/bench.list
// @cf use engine/bench-dip.js
/* NE555 timer in an 8-pin DIP (Texas Instruments SLFS022, NE555 P package): moulded body 9.8 x 6.35 mm. Pins 1 GND,
   2 TRIG, 3 OUT, 4 RESET, 5 CONT, 6 THRES, 7 DISCH, 8 VCC. Supply 4.5 V to 16 V (18 V absolute maximum), output
   current up to 200 mA either way. The comparators trip at two thirds and one third of the CONT voltage, which is
   the supply when CONT is left alone (10 V and 5 V at 15 V; 3.3 V and 1.67 V at 5 V, where CONT sits at 3.3 V). Output
   high is about 3.3 V at 5 V and 100 mA (13.3 V at 15 V); output low 0.1 V at 5 V and 5 mA; the discharge transistor
   is 0.15 V at 8 mA. Supply current 3 mA (output low) to 2 mA (output high) at 5 V, no load, 10 to 9 mA at 15 V.
   Astable: f = 1.44 / ((RA + 2 RB) C), high for 0.693 (RA + RB) C and low for 0.693 RB C.
   Facts: docs/facts/analog-parts.md section 2. */
(() => {
const B = SL.bench, T = B.T;
const DEMO = { off: { state: 'off' }, 'output high': { state: 'on' }, 'output low': { state: 'off' }, burnt: { state: 'burnt' } };
const meas = (p, m) => (m && m.state ? m : DEMO[p.demo] || m || {});
B.part('ne555', {
  name: 'NE555 timer',
  legs: ['GND', 'TRIG', 'OUT', 'RESET', 'CONT', 'THRES', 'DISCH', 'VCC'], span: [3, 3],
  params: { demo: Object.keys(DEMO) }, paramNames: { demo: 'Show' },
  tag: (p, m0) => { const m = meas(p, m0);
    if (m.state === 'burnt') return T('{id} · burnt', { id: p.id });
    if (m.state === 'on') return T('{id} · output high', { id: p.id });
    return p.id; },
  draw(ctx){
    const m = meas(ctx.p, ctx.m), live = m.state === 'on', dead = m.state === 'burnt';
    B.dip(ctx, { mark: 'NE555', dead, live, callouts: typeof ctx.label === 'function' && (!!ctx.sel || !!(B.md && B.md.def && B.md.def.partPage)),
      inside: (F, k) => B.dipInside(F, live, dead) });
  },
  fig: 'P32',
  show: { breadboard: 'mini', parts: [{ id: 'U1', part: 'ne555', holes: ['e8', 'e9', 'e10', 'e11', 'f11', 'f10', 'f9', 'f8'] }], wires: [] },
});
})();
