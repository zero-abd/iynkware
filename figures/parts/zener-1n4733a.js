// @cf title 1N4733A Zener diode
// @cf use engine/bench.list
/* 1N4733A 5.1 V Zener diode, DO-41 axial: black body 4.8 x 2.6 mm with a band at the cathode end and "4733A" printed
   along it, 0.8 mm tinned leads. Legs [anode, cathode]. Vishay sheet 1N4728A to 1N4761A (document 85816): VZ 5.1 V
   (5 %) at IZT 49 mA, ZZT 7 ohm at 49 mA, 1.3 W total dissipation (Ptot, leads 4 mm from the case at ambient), regulator current up to 178 mA,
   forward voltage at most 1.2 V at 200 mA. Fitted in reverse (cathode to the + side) it holds its terminals at 5.1 V
   while a series resistor takes up the rest: the shunt regulator. The usual way to burn it is a missing series resistor:
   at 12 V the diode alone would take far more than 1.3 W. Facts: docs/facts/analog-parts.md section 6.

   Solver contract: m = { state, i_mA, v } with state 'ok' (forward conducting), 'zener' (regulating in breakdown),
   'off', or 'burnt' (power above 1.3 W). */
(() => {
const B = SL.bench, T = B.T;
const callouts = ctx => typeof ctx.label === 'function' && (!!ctx.sel || !!(B.md && B.md.def && B.md.def.partPage));
const VZ = 5.1, ZZ = 7;
const EPOXY = { l: '#4a4642', m: '#34312e', d: '#1f1d1b' }, BAND = { l: '#e7e9e6', m: '#c3c7c3', d: '#878c88' };
const SI = { l: '#6f7f9a', m: '#4f5d78', d: '#2f3a50' };
const DEMO = { off: { state: 'off', i_mA: 0 }, 'regulating at 20 mA': { state: 'zener', i_mA: 20, v: 4.9 }, 'conducting forward': { state: 'ok', i_mA: 50, v: .75 }, burnt: { state: 'burnt', i_mA: 0 } };
const meas = (p, m) => (m && m.state ? m : DEMO[p.demo] || m || {});
B.part('zener-1n4733a', {
  name: '1N4733A Zener diode', legs: ['A', 'K'], span: [3, 8],
  params: { demo: Object.keys(DEMO) },
  paramNames: { demo: 'Show' },
  elec: () => ({ type: 'diode', vf: 0.7, vz: VZ, zz: ZZ, pmax: 1, polar: true }),
  tag: (p, m0) => {
    const m = meas(p, m0), id = p.id;
    if (!m.state) return id;
    if (m.state === 'burnt') return T('{id} · burnt', { id });
    if (m.state === 'zener') return T('{id} · {v} V in breakdown', { id, v: (m.v != null ? m.v : VZ).toFixed(2) });
    if (m.state === 'ok' && m.i_mA > 0) return T('{id} · {v} V · {n} mA', { id, v: (m.v != null ? m.v : .7).toFixed(2), n: Math.round(m.i_mA) });
    return id;
  },
  draw(ctx){
    const [a, b] = ctx.legs, p = ctx.p, m = meas(p, ctx.m), k = ctx.k != null ? ctx.k : (ctx.st && ctx.st.xr) || 0;
    const burnt = m.state === 'burnt', z = 2.5, d = [b[0] - a[0], b[1] - a[1]], len = Math.hypot(...d) || 1, u = [d[0] / len, d[1] / len];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2] + z], half = Math.min(2.4, len / 2 - 1.2);
    const at = t => [mid[0] + u[0] * t, mid[1] + u[1] * t, mid[2]];
    const c0 = at(-half), c1 = at(half), lead = .39;
    // legs: down from the holes, a bend, then along the axis into the body
    let s = rod(a, [a[0], a[1], a[2] + z - .4], lead, B.M.tin, toneI, .45) + rod([a[0], a[1], a[2] + z - .4], c0, lead, B.M.tin, toneI, .45)
      + rod(b, [b[0], b[1], b[2] + z - .4], lead, B.M.tin, toneI, .45) + rod([b[0], b[1], b[2] + z - .4], c1, lead, B.M.tin, toneI, .45);
    // the body, ghosted in see-through
    let body = rod(c0, at(half - 1.25), 1.3, burnt ? matOf('#2a2420') : EPOXY, toneI, .8) + rod(at(half - 1.25), at(half - .45), 1.31, BAND, toneI, .5)
      + rod(at(half - .45), c1, 1.3, burnt ? matOf('#2a2420') : EPOXY, toneI, .8);
    // marking along the top of the body, reading from anode to cathode (board direction = inverse of B.wdir)
    if (k < .5) body += B.flatText([mid[0] - u[0] * .5, mid[1] - u[1] * .5, mid[2] + 1.32], -u[1], -u[0], '4733A', .9, '#cfcac0', 700);
    if (k > .02){
      // inside: two tinned lead slugs and the glass-passivated PN chip between them
      const ins = rod(at(-half + .1), at(-.25), .62, B.M.tin, toneI, .5) + rod(at(.25), at(half - .1), .62, B.M.tin, toneI, .5)
        + rod(at(-.25), at(.25), .78, SI, toneI, .5) + (m.state === 'ok' || m.state === 'zener' ? `<circle cx="${f(P(...mid)[0])}" cy="${f(P(...mid)[1])}" r="2.2" fill="#ffd34d" opacity=".55"/>` : '');
      body = `<g opacity="${f(1 - .65 * k)}">${body}</g>` + `<g opacity="${f(k)}">${ins}</g>`;
      if (k > .5 && callouts(ctx)){
        ctx.label(mid, 'Silicon PN chip', m.state === 'ok' || m.state === 'zener');
        ctx.label(at(half + .4), 'Cathode band');
      }
    }
    s += body;
    if (burnt){ const [X, Y] = P(mid[0], mid[1], mid[2] + 2); s += `<circle cx="${f(X)}" cy="${f(Y - 4)}" r="3" fill="#8a847a" opacity=".45"/><circle cx="${f(X + 3)}" cy="${f(Y - 8)}" r="2.2" fill="#8a847a" opacity=".3"/>`; }
    const lo = [Math.min(a[0], b[0]) - 1.4, Math.min(a[1], b[1]) - 1.4, a[2]], hi = [Math.max(a[0], b[0]) + 1.4, Math.max(a[1], b[1]) + 1.4, a[2] + z + 1.4];
    ctx.put([lo, hi], s);
  },
  fig: 'P36',
  show: { breadboard: 'mini', parts: [
    { id: 'D1', part: 'zener-1n4733a', holes: ['c4', 'c9'] },
  ], wires: [] },
});
})();
