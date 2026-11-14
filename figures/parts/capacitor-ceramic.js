// @cf title Ceramic capacitor
// @cf use engine/bench.list
/* Radial multilayer ceramic capacitor (X7R class): a dipped yellow-brown body about 5 x 2.5 mm and 5 mm tall on two
   5.08 mm leads, marked with the three digit code (104 = 10 x 10^4 pF = 100 nF, 105 = 1 uF, 106 = 10 uF). No
   polarity. 100 nF is the usual decoupling value; ratings here are 50 V for 100 nF and 16 V for 10 uF as the common
   X7R/X5R families print them (docs/facts/analog-parts.md section 4). Open at DC; at high frequency its ESR is
   a few tens of milliohm. See-through: the body clears to show the stack of interleaved electrode plates. */
(() => {
const B = SL.bench, T = B.T;
const VALUES = { '100 nF': 1e-7, '1 uF': 1e-6, '10 uF': 1e-5 };
const CODE = { '100 nF': '104', '1 uF': '105', '10 uF': '106' };
const RATED = { '100 nF': 50, '1 uF': 25, '10 uF': 16 };
const DEF = { value: '100 nF', demo: 'ok' };
const DEMO = { ok: null, 'over its voltage': 'burnt' };
const BODY = { l: '#e6b94f', m: '#c99a33', d: '#8c6a1e' };
const frame = (legs) => {
  const o = [0, 1, 2].map(k => (legs[0][k] + legs[1][k]) / 2), dx = legs[1][0] - legs[0][0], dy = legs[1][1] - legs[0][1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
  const W = (a, b, z) => [o[0] + ux * a - uy * b, o[1] + uy * a + ux * b, o[2] + z];
  return { o, W, ux, uy, slab: (a0, b0, a1, b1, z0, z1, m, w = .6) => B.slabW(W, a0, b0, a1, b1, z0, z1, m, toneI, w) };
};
const valueOf = p => VALUES[p.value] ? p.value : DEF.value;
B.part('capacitor-ceramic', {
  name: 'Ceramic capacitor', fig: 'P33', legs: ['1', '2'], span: [2, 3],
  params: { value: Object.keys(VALUES), demo: Object.keys(DEMO) }, paramNames: { value: 'Value', demo: 'Show' },
  defaults: DEF,
  elec: p => ({ type: 'cap', farads: VALUES[valueOf(p)] }),
  tag: (p, m) => (DEMO[p.demo] || (m && m.state)) === 'burnt' ? T('{id} · burnt', { id: p.id }) : T('{id} · {v}', { id: p.id, v: valueOf(p).replace(' uF', ' µF') }),
  draw(ctx){
    const p = Object.assign({}, DEF, ctx.p), legs = ctx.legs, F = frame(legs), k = ctx.k != null ? ctx.k : (ctx.st && ctx.st.xr) || 0;
    const dead = (DEMO[p.demo] || (ctx.m && ctx.m.state)) === 'burnt', z0 = 1.6, z1 = 6.6, hl = 2.5, hw = 1.25;
    let s = '';
    for (const sd of [-1, 1]) s += rod(F.W(sd * 2.54, 0, -.3), F.W(sd * 2.54, 0, z0), .2, B.M.tin, toneI, .4) + rod(F.W(sd * 2.54, 0, z0), F.W(sd * 1.3, 0, z0 + 1.2), .2, B.M.tin, toneI, .4);
    let body = F.slab(-hl, -hw, hl, hw, z0, z1, dead ? matOf('#3a2d22') : BODY, .8);
    if (k < .5) body += B.flatText(F.W(0, 0, z1 + .01), -F.uy, -F.ux, CODE[valueOf(p)], 1.9, '#4a3410', 800);
    if (k > .02){
      let x = '';
      for (let i = 0; i < 6; i++){ const side = i % 2 ? -1 : 1; x += F.slab(side > 0 ? -1.9 : -2.2, -.6, side > 0 ? 2.2 : 1.9, .6, z0 + 1 + i * .65, z0 + 1.2 + i * .65, B.M.tin, .3); }
      x += rod(F.W(-2.54, 0, z0), F.W(-2.54, 0, z0 + 1.6), .2, B.M.tin, toneI, .3) + rod(F.W(2.54, 0, z0), F.W(2.54, 0, z0 + 1.6), .2, B.M.tin, toneI, .3);
      body = `<g opacity="${f(1 - .7 * k)}">${body}</g><g opacity="${f(k)}">${x}</g>`;
      if (k > .5 && typeof ctx.label === 'function' && (!!ctx.sel || !!(B.md && B.md.def && B.md.def.partPage))) ctx.label(F.W(0, 0, z0 + 3), 'Electrode plates');
    }
    s += body;
    if (dead){ const [X, Y] = P(...F.W(0, 0, z1 + 2)); s += `<circle cx="${f(X)}" cy="${f(Y - 4)}" r="3" fill="#8a847a" opacity=".45"/>`; }
    ctx.put([[Math.min(legs[0][0], legs[1][0]) - 3.5, Math.min(legs[0][1], legs[1][1]) - 3.5, F.o[2]], [Math.max(legs[0][0], legs[1][0]) + 3.5, Math.max(legs[0][1], legs[1][1]) + 3.5, F.o[2] + z1 + 1]], s);
  },
  show: { breadboard: 'mini', parts: [
    { id: 'C1', part: 'capacitor-ceramic', value: '100 nF', holes: ['c4', 'c6'] },
    { id: 'C2', part: 'capacitor-ceramic', value: '10 uF', holes: ['c10', 'c12'] },
  ], wires: [] },
});
})();
