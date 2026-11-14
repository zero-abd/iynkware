// @cf title LM358 dual op-amp
// @cf use engine/bench.list
// @cf use engine/bench-dip.js
/* LM358 dual operational amplifier in an 8-pin DIP (Texas Instruments SLOS068, 8-pin PDIP): moulded body 9.8 x 6.35
   mm. Pins 1 OUT1, 2 IN1- (leg IN1N), 3 IN1+ (IN1P), 4 V- (VEE, ground on one supply), 5 IN2+ (IN2P), 6 IN2- (IN2N), 7 OUT2, 8 V+ (VCC). Supply 3 V to 32 V
   (absolute maximum 32 V), 350 uA per amplifier typical, open-loop gain 100 V/mV typical, 0.7 MHz gain-bandwidth,
   0.3 V/us slew rate. The input range reaches down to V- and up to V+ minus 1.5 V; the output swings to within 20 mV
   of V- (single supply) and to within 1.5 V of V+ at light load, so on 5 V it tops out near 3.5 V. Output short
   circuit about 40 mA (60 mA max). Facts: docs/facts/analog-parts.md section 3. */
(() => {
const B = SL.bench, T = B.T;
const DEMO = { off: { state: 'off' }, amplifying: { state: 'active' }, 'clipping at the rail': { state: 'sat' }, burnt: { state: 'burnt' } };
const meas = (p, m) => (m && m.state ? m : DEMO[p.demo] || m || {});
B.part('lm358', {
  name: 'LM358 dual op-amp',
  legs: ['OUT1', 'IN1N', 'IN1P', 'VEE', 'IN2P', 'IN2N', 'OUT2', 'VCC'], span: [3, 3],
  params: { demo: Object.keys(DEMO) }, paramNames: { demo: 'Show' },
  tag: (p, m0) => { const m = meas(p, m0);
    if (m.state === 'burnt') return T('{id} · burnt', { id: p.id });
    if (m.state === 'sat') return T('{id} · output clipped', { id: p.id });
    return p.id; },
  draw(ctx){
    const m = meas(ctx.p, ctx.m), live = m.state === 'active' || m.state === 'sat', dead = m.state === 'burnt';
    B.dip(ctx, { mark: 'LM358', dead, live, callouts: typeof ctx.label === 'function' && (!!ctx.sel || !!(B.md && B.md.def && B.md.def.partPage)),
      inside: (F, k) => B.dipInside(F, live, dead) });
  },
  fig: 'P31',
  show: { breadboard: 'mini', parts: [{ id: 'U1', part: 'lm358', holes: ['e8', 'e9', 'e10', 'e11', 'f11', 'f10', 'f9', 'f8'] }], wires: [] },
});
})();
